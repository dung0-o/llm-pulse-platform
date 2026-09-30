# Testing

Four test suites cover different layers. Each has a distinct purpose, and each is runnable in CI without external credentials.

## Strategy

The suite is deliberately **small and targeted**. It covers the parts where bugs have actually occurred, and it skips the parts where a test would be more expensive than the bug it prevents.

| Layer | Tool | Files | What it covers |
| :--- | :--- | :--- | :--- |
| Python unit | pytest | `tests/unit/` | Pure functions - regex builders, score mapping, schema validation |
| Python integration | pytest + FastAPI TestClient | `tests/integration/` | HTTP layer with mocked dependencies |
| dbt | dbt test | `dbt/models/**/schema.yaml`, `dbt/tests/` | Data invariants |
| TypeScript | Vitest | `dashboard/src/**/*.test.ts` | Numeric coercion, color assignment |

What is **not** tested:

- **The ML model itself.** A test that asserts a specific sentiment score would break every time the model or its version changes, and it would tell you nothing useful. The model's behavior is verified by manual inspection and by the `gold_sentiment_predictions` schema test.
- **The dashboard components.** They are presentational. The two with logic (filter card, refresh button) depend on TanStack Query, which would require a mock layer whose maintenance cost exceeds its value.
- **The scraper's network calls.** Mocking `feedparser` and `httpx` would test the mock, not the code.
- **End-to-end.** There is no Playwright or Cypress suite. The effort to maintain one for a portfolio project is disproportionate to the bugs it would catch.

The test suites exist to catch regressions in the parts that have already broken. Every test in the repo corresponds to a bug that was fixed or a class of bug that is likely.

## Running tests

```bash
make test
```

This runs, in order:

1. `pytest tests/` - Python unit and integration
2. `dbt test --profiles-dir .` - dbt generic and singular tests
3. `npm run test` - Vitest

Individual suites:

```bash
pytest tests/unit -v                      # unit only
pytest tests/integration -v               # integration only
pytest -m "not integration" -v            # everything except integration
cd dbt && dbt test --profiles-dir .       # dbt only
cd dashboard && npm run test              # TypeScript only
```

## Python unit tests

### `tests/conftest.py`

Sets up `sys.path` so `api/` and `scripts/` modules are importable by their bare names:

```python
ROOT = Path(__file__).resolve().parents[1]
for p in (ROOT / "api", ROOT / "scripts"):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))
```

This is why test files import `from generate_model_list import ...` and `from inference import ...` rather than `from api.generate_model_list import ...`. The API is not a package - adding `api/__init__.py` would break the `from database import ...` imports inside `main.py`.

### `tests/unit/test_generate_model_list.py`

Covers the highest-risk function in the project: `make_regex_pattern`. A single character wrong in the pattern silently misses mentions or produces false positives that pollute the Gold table.

Parameterized cases:

```python
@pytest.mark.parametrize(
    ("family", "text", "should_match"),
    [
        ("Qwen3.8", "Qwen3.8 is great", True),
        ("Qwen3.8", "Qwen 3.8 is great", True),
        ("Qwen3.8", "Qwen-3.8 is great", True),
        ("Phi-4",    "PHI-4 rocks",       True),
        ("Llama",    "LLAMA is fast",     True),
        ("Phi",      "philosophy is hard", False),  # known false positive
        ("Mistral Large", "Mistral-Large", True),
        ("Gemma",    "Qwen is fast",      False),
    ],
)
def test_make_regex_pattern(family, text, should_match):
    ...
```

The `Phi` / `philosophy` case is the reason the trailing `\b` exists in the pattern. Without it, `(?i)\bPhi` matches the first three characters of `philosophy`.

Other tests cover:

- `load_models()` exits with code 1 on a missing file or empty list
- `write_dbt_seed()` emits a brand fallback row only when no family matches the brand
- `write_ts()` produces a valid TypeScript module with the expected exports

### `tests/unit/test_inference.py`

Pins the flexible parser.

```python
@pytest.mark.parametrize(
    ("inference_resp", "expected"),
    [
        ({'label': 'Positive', 'score': 0.92}, 0.92),
        ({'label': 'Negative', 'score': 0.92}, -0.92),
        ({'label': 'POSITIVE', 'score': 0.5}, 0.5),
        ({'label': 'NEGATIVE', 'score': 0.5}, -0.5),
        ({'label': 'Neutral', 'score': 0.8}, 0.0),
        ({'label': 'unknown', 'score': 0.8}, None),
        ({'label': '', 'score': 0.8}, None),
        ({'score': 0.8}, None),
        ([0.92, 'Positive'], 0.92),
        (0.92, 0.92),
    ],
)
def test_response_parser(inference_resp, expected) -> None:
    assert _parse_sentiment_result(inference_resp) == pytest.approx(expected)
```

### `tests/unit/test_schemas.py`

Validates that the Pydantic models accept valid inputs and reject invalid ones.

| Test | Assertion |
| :--- | :--- |
| `test_rank_response_accepts_empty_ranking` | Empty list is valid |
| `test_rank_response_roundtrips_json` | `model_dump_json()` → `model_validate_json()` produces an identical object |
| `test_health_response_rejects_invalid_status` | `bigquery="maybe"` raises `ValidationError` |
| `test_trend_point_requires_date` | `date=None` raises `ValidationError` |

The roundtrip test is the important one - it catches a class of bug where a field is declared with a type that cannot be serialized and deserialized identically.

## Python integration tests

### `tests/integration/test_api.py`

Exercises the HTTP layer end-to-end: routing, query parameter validation, response models, and cache behavior. BigQuery, Redis, and the inference backend are monkeypatched, so the suite runs without credentials.

The fixture:

```python
@pytest.fixture
def app_client(monkeypatch):
    import main as main_module
    fake_redis = FakeRedis()

    monkeypatch.setattr(main_module, "RedisClient", lambda: fake_redis)
    monkeypatch.setattr(main_module, "query_leaderboard", lambda *a, **k: [])
    monkeypatch.setattr(main_module, "check_bigquery_connection", lambda: True)
    monkeypatch.setattr(main_module, "inference_health_check", lambda: True)

    app = main_module.create_app()
    return TestClient(app), fake_redis
```

`import main` - not `import api.main`. The `conftest.py` puts `api/` on `sys.path`, so modules are importable by their bare names.

Tests:

| Test | What it verifies |
| :--- | :--- |
| `test_health_reports_all_subsystems` | `/health` returns 200 with all three dependencies connected |
| `test_leaderboard_returns_empty_ranking` | Empty DB produces `ranking: []`, not an error |
| `test_leaderboard_rejects_days_out_of_range` | `days=0`, `days=31`, `days=200` return 422 |
| `test_leaderboard_caches_response` | The second identical request hits the fake Redis |
| `test_refresh_bypasses_cache` | `?refresh=true` increments the query call count |
| `test_search_requires_keyword` | Missing `keyword` returns 422; empty string returns 200 |

The `test_refresh_bypasses_cache` test is the most valuable:

```python
def test_refresh_bypasses_cache(app_client, monkeypatch):
    client, redis = app_client
    import main as main_module

    calls = {"n": 0}
    def counting_query(*a, **k):
        calls["n"] += 1
        return []

    monkeypatch.setattr(main_module, "query_leaderboard", counting_query)

    client.get("/leaderboard?days=7")                # miss → 1
    client.get("/leaderboard?days=7")                # hit  → 1
    client.get("/leaderboard?days=7&refresh=true")   # bypass → 2

    assert calls["n"] == 2
```

This verifies the exact contract of the `refresh` parameter: it bypasses Redis for one request without clearing the cache.

### `tests/integration/test_backfill.py`

Covers the write path. It does not touch BigQuery - it verifies the orchestration logic: deduplication, chunking, and empty-input handling.

| Test | Verifies |
| :--- | :--- |
| `test_empty_payload_is_a_noop` | `update_sentiments_bulk([])` returns 0 and issues no queries |
| `test_single_batch_issues_one_merge` | One row → one `MERGE` containing `CREATE TEMP TABLE` |
| `test_deduplicates_by_mention_id` | Duplicate IDs collapse to one row |
| `test_chunks_large_batches` | With `BULK_CHUNK_SIZE=2`, 5 rows → 3 jobs |

The `test_deduplicates_by_mention_id` test exists because of a real issue: if the payload contains two rows with the same `mention_id`, BigQuery's `MERGE` fails with `UPDATE/MERGE must match at most one source row for each target row`. The deduplication step is what prevents that.

## dbt tests

### Generic tests

Declared in `schema.yaml` files. Run as part of `dbt build`.

`dbt/models/silver/schema.yaml`:

```yaml
models:
  - name: silver_cleaned_posts
    columns:
      - name: post_id
        data_tests: [not_null, unique]
      - name: title
        data_tests: [not_null]
      - name: published_at
        data_tests: [not_null]
      - name: url
        data_tests: [not_null, unique]
```

`dbt/models/gold/schema.yaml`:

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

The `relationships` test is a foreign-key check. Every mention must trace back to a real post. A failure means the explosion logic produced a `post_id` that does not exist in Silver - a sign of a join bug or a stale partition.

### Singular tests

**`assert_no_orphan_predictions.sql`**

```sql
SELECT p.mention_id
FROM {{ source('ml', 'gold_sentiment_predictions') }} p
LEFT JOIN {{ ref('gold_post_features') }} f
  ON p.mention_id = f.mention_id
WHERE f.mention_id IS NULL
```

Fails when a prediction exists for a mention that no longer appears in the feature table. This happens after a `config/models.yaml` edit that changes a `mention` string. The `mention_id` is derived from the mention, so a rename orphans every prediction for that family.

The fix is `make backfill`, which runs `purge_orphan_predictions()` before scoring new mentions.

## TypeScript tests

### `dashboard/src/lib/utils.test.ts`

Covers the numeric safety helpers. These exist because a `null` sentiment score previously crashed the leaderboard with `Cannot read properties of undefined (reading 'toFixed')`.

| Function | Cases |
| :--- | :--- |
| `formatNumber` | Thousand separators |
| `scoreToLabel` | `≥ 0.15` → Positive, `≤ -0.15` → Negative, otherwise Neutral |
| `scoreColor` | Returns a `text-*` class, never a hex |
| `formatRelativeDate` | `"just now"` for the current instant; `"2h ago"` for recent dates |

### `dashboard/src/features/share-of-voice/colors.test.ts`

Covers `buildColorMap`, which assigns a deterministic hue to each family.

| Test | Verifies |
| :--- | :--- |
| `returns one color per row` | Length matches input |
| `is deterministic across calls` | Same input → same output |
| `gives every family the same hue regardless of position` | Hashing is order-independent |
| `shares hue but varies lightness within a family when ungrouped` | Sibling versions cluster visually |
| `gives different hues to different families` | No accidental collisions |

The lightness test parses the `hsl(...)` string and asserts that lightness strictly increases across versions of the same family. This is what makes `Qwen-3.5`, `Qwen-3.6`, and `Qwen-3.8` visually distinguishable in a pie chart while still appearing related.

## CI configuration

```yaml
# .github/workflows/ci.yml
jobs:
  python:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.11"
          cache: pip
      - run: pip install -r requirements-dev.txt
      - run: pip install -r api/requirements.txt
      - run: ruff check .
      - run: pytest -m "unit or integration" --cov=api --cov=scripts -q

  dashboard:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: dashboard
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: npm
          cache-dependency-path: dashboard/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build

  scraper:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: "3.11"
          cache: pip
      - run: pip install -r scraper/requirements.txt
      - run: cd dbt && dbt parse --profiles-dir . --profile local_llm_sentiment
        env:
          GCP_PROJECT_ID: placeholder
          BQ_DATASET_NAME: placeholder
          BQ_DATASET_LOCATION: us-central1
```

Three points about the CI configuration:

1. **`npm run build` runs in CI.** The build command is `tsc -b && vite build`, which is what Vercel runs. If CI passes and Vercel fails, the CI was lying. Running the same command closes that gap.

2. **`dbt parse` with placeholder credentials.** This validates YAML syntax and reference resolution without connecting to BigQuery. Full `dbt test` runs in the scrape workflow, where credentials already exist.

3. **`pytest -m "unit or integration"`.** The marker filter allows a future split where `unit` runs on every push and `integration` runs only on pull requests, if the suite grows large enough to justify the distinction.

## Markers

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra -q --strict-markers"
markers = [
    "unit: fast, no I/O",
    "integration: mocked external services",
]
```

`--strict-markers` fails the run if a test uses a marker that is not registered. This prevents typos like `@pytest.mark.unti` from silently skipping a test.

## Coverage

There is no coverage threshold. The suite is too small for a percentage to be meaningful, and enforcing a threshold would encourage writing tests for trivial code to hit a number.

If you want to see what is covered:

```bash
pytest --cov=api --cov=scripts --cov-report=term-missing
```

The output shows which lines are exercised. In practice, the covered modules are `inference.py`, `schemas.py`, `database.py`, and `generate_model_list.py`. The scraper and the dbt models are not covered by Python tests - the scraper is integration-tested by running it, and the dbt models are tested by `dbt test`.

## What a new test should look like

Before adding a test, ask:

1. **Does this test correspond to a bug that has occurred, or a class of bug that is likely?** If neither, skip it.
2. **Does the test exercise real logic, or a mock?** A test that verifies a mock's behavior is worse than no test.
3. **Will this test break when the implementation changes in a legitimate way?** If a refactor breaks the test but not the behavior, the test is coupled to the implementation rather than the contract.

The tests in this repo pass all three questions. The `test_schemas` tests correspond to a real bug. The FastAPI tests exercise the real routing and validation layers with mocks only at the I/O boundary. The `buildColorMap` tests assert contract-level properties (determinism, hue sharing) rather than exact hex values.

A test that violates any of these - for example, a snapshot test of the dashboard's HTML, or a test that asserts a specific sentiment score - should not be added. Those tests break for reasons unrelated to correctness, and they train the developer to ignore failures.
