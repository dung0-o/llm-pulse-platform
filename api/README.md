# API

FastAPI service exposing the sentiment tracker. Deployed to Cloud Run.

## Local run

```bash
cd api
python -m uvicorn main:app --reload
```

Requires BigQuery credentials (`gcloud auth application-default login`) and a `.env` at the repo root.

## Endpoints

See [../docs/03_API_SPEC.md](../docs/03_API_SPEC.md).

## Jobs

The `jobs/` directory contains CLI entrypoints. Run them as modules from within `api/`:

```bash
cd api
python -m jobs.backfill --days 30
```

`python -m` is required - running `python jobs/backfill.py` breaks relative imports.

## Docker

```bash
docker build -t api:dev .
docker run --rm -p 8080:8080 --env-file ../.env \
  -v ~/.config/gcloud/application_default_credentials.json:/tmp/adc.json:ro \
  -e GOOGLE_APPLICATION_CREDENTIALS=/tmp/adc.json \
  api:dev
```
