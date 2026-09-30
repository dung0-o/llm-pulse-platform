# ADR-001: ELT over ETL

**Status:** Accepted
**Date:** 2026-09-15

## Context

The pipeline ingests Reddit posts, cleans them, extracts model mentions, and produces feature-engineered rows for sentiment classification. The transformation logic is non-trivial: HTML stripping, regex extraction of family names and versions, mention explosion, context-window extraction.

Two approaches were available:

1. **ETL** - transform the data in Python before writing it to the warehouse. The scraper's output would be the cleaned, structured rows.
2. **ELT** - load the raw data unmodified, then transform it inside the warehouse using SQL.

The transformation logic is expected to change repeatedly. The model list will grow; the regexes will be refined; the context-window size may be tuned. Each change should not require re-scraping.

## Decision

We use **ELT**. The scraper uploads raw JSONL to GCS. All cleaning, deduplication, and feature extraction happens in dbt models running as SQL in BigQuery.

## Consequences

### Positive

- **Replayability.** A regex fix is a `dbt run` against existing Bronze data. No re-scraping, no rate-limit exposure, no data loss from posts that have aged off Reddit's front page.
- **Cheaper.** BigQuery processes terabytes in seconds. The same transformation in Python on a GitHub runner is slower and consumes CI minutes.
- **Simpler scraper.** The scraper becomes a "dumb" data mover - fetch, write, exit. All business logic lives in SQL, where it is version-controlled, tested by `dbt test`, and documented in the dbt DAG.
- **Auditability.** The Bronze layer is a faithful record of what Reddit returned. If the transformation is wrong, the source of truth is still intact.

### Negative

- **BigQuery dependency.** Transformation requires an active BigQuery dataset and a service account with query permissions. Local development without GCP credentials is not possible past the Bronze layer.
- **SQL complexity.** Mention explosion and window extraction are easier to read in pandas than in SQL `CROSS JOIN` + `SUBSTR` + `GREATEST`. A future maintainer needs SQL fluency to work on the models.
- **Query cost.** Every transformation run consumes BigQuery bytes processed. At the current data volume this is under 5 GB/month against a 1 TB free tier, but it is not zero.

### Neutral

- The Bronze layer is untyped JSON. BigQuery infers the schema on read. If Reddit changes the RSS structure, the external table picks up the new field names, and the staging model may need updating.

## Alternatives considered

| Alternative | Why rejected |
| :--- | :--- |
| Transform in Python, load cleaned rows | Every logic change requires a re-scrape; GitHub runners are slower than BigQuery; loses the raw Bronze record |
| Hybrid - light cleaning in Python, heavy in SQL | Two places to look for logic; the split is arbitrary and would drift |
| Stream directly into BigQuery via Storage Write API | Charged per request; loses the GCS staging layer that enables replay |

## References

- [dbt documentation: Why ELT?](https://docs.getdbt.com/terms/elt)
- [docs/02_DBT_TRANSFORMATIONS.md](../02_DBT_TRANSFORMATIONS.md)
