# dbt

Transforms Bronze (raw JSONL in GCS) into Silver (cleaned posts) and Gold (feature-engineered).

## Run

```bash
cd dbt
dbt build --profiles-dir . --profile local_llm_sentiment
```

`dbt build` runs seeds, models, and tests in DAG order, so failing tests block downstream models.

## Environment

`profiles.yml` reads three variables from the environment:

| Variable | Purpose |
| :--- | :--- |
| `GCP_PROJECT_ID` | BigQuery project |
| `BQ_DATASET_NAME` | Dataset for all models |
| `BQ_DATASET_LOCATION` | Region (must match the dataset's actual location) |

These come from the root `.env` via `scripts/_lib.sh`. Do not hardcode them.

## Model layers

| Layer | Materialization | Owner |
| :--- | :--- | :--- |
| `staging` | view | Reads Bronze |
| `silver` | table, merge on `post_id` | Deduplicated posts |
| `gold` | table, partitioned by `publish_date` | Feature-engineered mentions |

`gold_post_enriched` is a **view** that joins Gold features with the ML predictions table. The predictions table is a source, not a model - it is written by the API's backfill job, and dbt never rebuilds it.
