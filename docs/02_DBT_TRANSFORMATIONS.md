# dbt transformations

## Project layout

```
dbt/
├── dbt_project.yml
├── profiles.yml
├── models/
│   ├── sources.yaml              # Bronze external table, ML predictions
│   ├── staging/
│   │   └── stg_raw_posts.sql
│   ├── silver/
│   │   ├── silver_cleaned_posts.sql
│   │   └── schema.yaml
│   └── gold/
│       ├── gold_post_features.sql
│       ├── gold_post_enriched.sql
│       └── schema.yaml
├── seeds/
│   └── models.csv
└── tests/
    └── assert_no_orphan_predictions.sql
```

## Sources

Declared in `dbt/models/sources.yaml`:

```yaml
sources:
  - name: bronze
    database: "{{ env_var('GCP_PROJECT_ID') }}"
    schema: "{{ env_var('BQ_DATASET_NAME') }}"
    tables:
      - name: raw_posts
        description: "External table over gs://.../ingest_date=*/"

  - name: model
    database: "{{ env_var('GCP_PROJECT_ID') }}"
    schema: "{{ env_var('BQ_DATASET_NAME') }}"
    tables:
      - name: gold_sentiment_predictions
        description: "Written by the backfill job. Never rebuilt by dbt."
```

## Seeds

### `models.csv`

Generated from `config/models.yaml` by `scripts/generate_model_list.py`. One row per (brand, family) pair, plus a brand row for each brand:

| Column | Type | Notes |
| :--- | :--- | :--- |
| `brand` | STRING | E.g. `Qwen` |
| `model` | STRING | E.g. `Qwen`, `Qwen 3.8` |
| `is_specific_family` | BOOL | `true` for family rows, `false` for the brand row |
| `pattern` | STRING | Precomputed RE2 regex for matching this name in a post full text |

The `pattern` column is what makes the seed useful. It is generated once by Python and consumed directly by SQL, so the family list lives in exactly one place.

Load the seed:

```bash
cd dbt && dbt seed --select models --profiles-dir .
```

Seeds are not built by `dbt run`. The `make seed` target calls `dbt seed` explicitly.

## Staging

### `stg_raw_posts.sql`

Materialized as a **view**. Its only job is to project and rename columns from the external table. No deduplication, no cleaning.

```sql
SELECT
  id,
  title,
  link AS url,
  author,
  published AS published_at,
  updated AS updated_at,
  scraped_at,
  COALESCE(
    (SELECT value FROM UNNEST(content) WHERE type = 'text/html'),
    summary
  ) AS raw_html
FROM {{ source('bronze', 'raw_posts') }}
```

Why a staging layer exists at all: if the external table's schema changes (Reddit renames a field, BigQuery infers a different type), only this file changes. Silver and Gold reference `{{ ref('stg_raw_posts') }}` and are unaffected.

## Silver

### `silver_cleaned_posts.sql`

Materialized as a **table**, incremental on `post_id` with merge strategy.

```sql
{{ config(
    materialized='table',
    incremental_strategy='merge',
    unique_key='post_id',
    partition_by={'field': 'published_at', 'data_type': 'timestamp'}
) }}
```

### Transformation steps

**Step 1 - Extract the post ID.**

```sql
REGEXP_EXTRACT(id, r't3_([a-z0-9]+)') AS post_id
```

Reddit's ID field is a URL like `.../t3_1w6aec4`. The base36 suffix is the stable identifier.

**Step 2 - Strip HTML.**

`content[0].value` contains a Reddit-specific wrapper:

```html
<!-- SC_OFF --><div class="md"><p>Body text</p>...<br /> more text</div><!-- SC_ON -->
```

The cleaning pipeline:

```sql
REGEXP_REPLACE(raw, r'<!-- SC_OFF -->|<!-- SC_ON -->', '')     -- remove wrapper comments
REGEXP_REPLACE(..., r'<div class="md">|</div>', '')            -- remove the div
REGEXP_REPLACE(..., r'<br\s*/?>', '\n')                        -- preserve line breaks
REGEXP_REPLACE(..., r'<[^>]+>', '')                            -- remove remaining tags
REGEXP_REPLACE(..., r'&#(\d+);', ' ')                          -- decode numeric entities
REPLACE(REPLACE(..., '&lt;', '<'), '&gt;', '>')                -- decode named entities
```

The order matters. `<br />` becomes a newline **before** the generic tag-stripping regex runs, otherwise paragraph breaks are lost.

**Step 3 - Trim the boilerplate tail.**

RSS entries end with `submitted by /u/... [link] [comments]`. This is stripped with:

```sql
REGEXP_EXTRACT(text, r'^(.*?)\s+submitted by')
```

If the match fails (older entries without the boilerplate), the full text is used.

**Step 4 - Deduplicate.**

```sql
ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY scraped_at DESC) AS rn
```

A post that stays on the front page for a day appears in four scrape runs. The window function keeps the most recent version of each post.

**Step 5 - Drop invalid rows.**

```sql
WHERE title IS NOT NULL
  AND TRIM(title) != ''
  AND published_at IS NOT NULL
  AND LENGTH(full_text) > 10
```

Posts with empty titles or a body under 10 characters are not useful for sentiment analysis.

### `gold_post_features.sql`

Materialized as a **table**, partitioned by `publish_date`, clustered by `brand`.

```sql
{{ config(
    materialized='table',
    partition_by={'field': 'publish_date', 'data_type': 'date'},
    cluster_by=['brand']
) }}
```

This is the model that turns a post into one row per mention. A post comparing Qwen and Gemma produces two rows; a post mentioning Qwen once produces one.

#### Step 1 - Cross join with the seed

```sql
FROM {{ ref('silver_cleaned_posts') }} s
CROSS JOIN {{ ref('models') }} m
WHERE REGEXP_CONTAINS(s.full_text, m.pattern)
```

Each Silver row is paired with every seed row, then filtered to the pairs where the pattern actually matches. A post mentioning two families produces two rows; one mentioning five produces five.

The seed's `is_specific_family` flag distinguishes a family entry (`Qwen 3.8`) from a brand fallback entry (`Qwen`). The fallback exists so that a post mentioning the brand without naming a specific model still contributes to the brand's row count.

#### Step 2 - Extract the mention

```sql
TRIM(REGEXP_EXTRACT(s.full_text, m.pattern)) AS mention,
REGEXP_INSTR(s.full_text, m.pattern) AS mention_position
```

`REGEXP_EXTRACT` returns the actual substring that matched - `Qwen`, `Qwen3.8`, `Qwen 3.8`, depending on what appeared in the post. This is the mention as the author wrote it, not a normalized form.

`REGEXP_INSTR` returns the character position of that match, which is used in step 3 to deduplicate overlapping matches.

#### Step 3 - Deduplicate overlapping matches

A post that says "Qwen 3.8 is fast" contains a substring that matches both the `Qwen` pattern and the `Qwen 3.8` pattern. Both matches start at the same character position. Keeping both would produce two rows for what is conceptually one mention.

```sql
QUALIFY ROW_NUMBER() OVER (
  PARTITION BY post_id, mention_position
  ORDER BY is_specific_family DESC, LENGTH(model) DESC
) = 1
```

The window partitions by `(post_id, mention_position)`, so matches starting at the same position compete. The ordering resolves the tie:

| Order key | Direction | Effect |
| :--- | :--- | :--- |
| `is_specific_family` | `DESC` | `true` (specific family) beats `false` (brand fallback) |
| `LENGTH(model)` | `DESC` | Longer names beat shorter ones |

The result: for "Qwen 3.8 is fast", the `Qwen3.8` row wins over the `Qwen` row, because it is marked `is_specific_family = true` and is longer.

#### Step 4 - Primary key

```sql
CONCAT(s.post_id, '-', m.model) AS mention_id
```

The primary key is `post_id` concatenated with the seed's `model` value, not with the extracted `mention` text. This is deliberate: the seed's `model` is a canonical name from `config/models.yaml`, so the ID is stable across rewordings. A post that says "Qwen3.8" in one scrape and "Qwen 3.8" in another (because the author edited it) produces the same `mention_id` either way.

The trade-off: if `config/models.yaml` is edited to rename a family, every `mention_id` for that family changes, orphaning its predictions. This is handled by `purge_orphan_predictions()` in the backfill job, and by the `assert_no_orphan_predictions` dbt test.

#### Schema

| Column | Type | Source |
| :--- | :--- | :--- |
| `mention_id` | STRING | `CONCAT(post_id, '-', model)` - primary key |
| `post_id` | STRING | From Silver |
| `url` | STRING | From Silver |
| `author` | STRING | From Silver |
| `title` | STRING | From Silver |
| `full_text` | STRING | From Silver - sent to the model as-is |
| `brand` | STRING | From seed |
| `model` | STRING | From seed - canonical family name |
| `pattern` | STRING | From seed - the regex that matched |
| `is_specific_family` | BOOL | From seed |
| `mention` | STRING | `REGEXP_EXTRACT(full_text, pattern)` - the text as written |
| `mention_position` | INT64 | `REGEXP_INSTR(full_text, pattern)` |
| `published_at` | TIMESTAMP | From Silver |
| `publish_date` | DATE | From Silver - partition key |

### `gold_post_enriched.sql`

A view. No materialization, no partition:

```sql
{{ config(materialized='view') }}

SELECT
  f.*,
  p.sentiment_score,
  p.sentiment_label,
  p.scored_at
FROM {{ ref('gold_post_features') }} AS f
LEFT JOIN {{ source('model', 'gold_sentiment_predictions') }} AS p
  ON f.mention_id = p.mention_id
```

The LEFT JOIN is intentional. Unscored rows appear with `NULL` sentiment, and the backfill's `query_null_sentiment_posts()` finds them by filtering on that null.

## Tests

### Generic tests

Declared in `schema.yaml` files. The important ones:

```yaml
models:
  - name: gold_post_features
    columns:
      - name: mention_id
        data_tests: [not_null, unique]
      - name: post_id
        data_tests:
          - not_null
          - relationships:
              to: ref('silver_cleaned_posts')
              field: post_id
      - name: brand
        data_tests:
          - not_null
      - name: mention
        data_tests:
          - not_null
      - name: publish_date
        data_tests:
          - not_null
```

The `relationships` test is a foreign-key check. Every mention must trace back to a real post.

### Singular tests

**`assert_no_orphan_predictions.sql`**

```sql
SELECT p.mention_id
FROM {{ source('model', 'gold_sentiment_predictions') }} p
LEFT JOIN {{ ref('gold_post_features') }} f
    ON p.mention_id = f.mention_id
WHERE f.mention_id IS NULL
```

Fails when a prediction exists for a mention that no longer appears in the feature table. This happens after a model-list edit. The fix is `make backfill`, which purges orphans before scoring new mentions.

## Materialization strategy

| Model | Materialization | Why |
| :--- | :--- | :--- |
| `stg_raw_posts` | view | Cheap projection, no storage |
| `silver_cleaned_posts` | table, merge on `post_id` | Deduplication is expensive; persist the result |
| `gold_post_features` | table, insert overwrite | Full rebuild on every run - the extraction logic is the source of truth |
| `gold_post_enriched` | view | Joins two tables, no state to maintain |

`gold_post_features` uses `INSERT OVERWRITE` rather than incremental. The reason is that a regex change or a normalization rule change affects **all** rows, not just new ones. A full rebuild is the simplest way to guarantee the table reflects the current rules. At 1,400 rows, the cost difference is negligible.

## Incremental logic

`silver_cleaned_posts` is the only incremental model. The filter:

```sql
{% if is_incremental() %}
WHERE scraped_at > (SELECT MAX(scraped_at) FROM {{ this }})
{% endif %}
```

Only posts scraped since the last run are processed. The `MERGE` on `post_id` handles the case where a post appears in multiple runs - the newest `scraped_at` wins.

## Running dbt

```bash
cd dbt

# Full build: seeds, models, tests, in DAG order
dbt build --profiles-dir . --profile local_llm_sentiment

# Just the seed (after editing config/models.yaml)
dbt seed --select models --profiles-dir .

# Just the tests (against current data)
dbt test --profiles-dir . --profile local_llm_sentiment

# Parse only, no BigQuery connection - used in CI
dbt parse --profiles-dir . --profile local_llm_sentiment
```

`dbt build` is preferred over `dbt run && dbt test` because it runs tests **inline** in DAG order. A failing test on `silver_cleaned_posts` blocks `gold_post_features` from materializing, so bad data never reaches the Gold layer.

The CI workflow runs `dbt parse` only, with placeholder credentials. This validates YAML and refs without connecting to BigQuery, which keeps CI fast and avoids needing service-account credentials in GitHub for pull requests.
