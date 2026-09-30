# Infrastructure

Provisioned GCP resources. Everything here is applied once at setup; it does not run on every deploy.

## Contents

| Path | Applied by | Purpose |
| :--- | :--- | :--- |
| `bigquery/*.sql.tmpl` | `scripts/bootstrap_gcp.sh` | External table for Bronze, predictions table |
| `cloud-run/api-service.yaml` | `.github/workflows/api-deploy.yml` | Cloud Run service definition |

## Templates

`bigquery/*.sql.tmpl` files use `${VAR}` placeholders. `bootstrap_gcp.sh` renders them with `envsubst` into `bigquery/.rendered/` (gitignored) and applies each with `bq query`.

## Cloud Run service

`api-service.yaml` is applied via `gcloud run services replace` in the deploy workflow, with `${IMAGE}` substituted for the freshly built tag. Env-var placeholders are substituted at the same step; secrets are referenced by name and fetched from Secret Manager at container start.

See [../docs/07_DEPLOYMENT.md](../docs/07_DEPLOYMENT.md) for the full setup.
