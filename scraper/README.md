# Scraper

Fetches posts from [r/LocalLLaMA](https://reddit.com/r/LocalLLaMA) via RSS and uploads them to GCS as newline-delimited JSON. Runs on a GitHub Actions cron every day.

## Local run

```bash
cd scraper
python main.py
```

Requires `GCS_BUCKET_NAME` and `GCP_PROJECT_ID` in the root `.env`.

## Output

One JSONL file per run:

```
gs://BUCKET/ingest_date=YYYY-MM-DD/HH-MM.jsonl
```

The `ingest_date=` prefix is what makes the BigQuery external table Hive-partitioned. See [infra/bigquery/raw_posts.sql.tmpl](../infra/bigquery/raw_posts.sql.tmpl).
