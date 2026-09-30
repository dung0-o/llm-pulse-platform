# Deployment

The system runs on four external platforms, all on free tiers. This document covers the one-time setup and the CI/CD pipelines.

## Overview

| Component | Platform | Region | Trigger |
| :--- | :--- | :--- | :--- |
| Scraper | GitHub Actions | - | Cron, every day |
| dbt | GitHub Actions | - | Same workflow as scraper |
| API | Cloud Run | `us-central1` | Push to `main` under `api/**` |
| Dashboard | Vercel | Global edge | Push to `main` under `dashboard/**` |
| Data lake | GCS | `us-central1` | Written by scraper |
| Warehouse | BigQuery | `us-central1` | Written by dbt and backfill |
| Cache | Upstash Redis | `us-central1` | Written by API |

Everything except the Vercel edge lives in `us-central1`. This is deliberate - cross-region queries between Cloud Run and BigQuery would incur egress charges and add latency.

## Prerequisites

| Tool | Purpose | Install |
| :--- | :--- | :--- |
| `gcloud` CLI | Provisioning, deployment | [cloud.google.com/sdk/docs/install](https://cloud.google.com/sdk/docs/install) |
| Docker | Local image build | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| Python 3.11+ | Scraper, dbt, API, scripts | [python.org](https://www.python.org/) |
| Node 20+ | Dashboard | [nodejs.org](https://nodejs.org/) |
| `envsubst` | Template rendering | `apt install gettext` (Debian/Ubuntu) |

Verify:

```bash
make doctor
```

This checks each prerequisite and prints a single, copy-pasteable install command for anything missing.

## One-time GCP setup

All commands assume:

```bash
export PROJECT=local-llm-sentiment
export REGION=us-central1
export BUCKET=local-llm-sentiment-lake
export DATASET=local_llm_sentiment_dataset
```

### 1. Create the project and enable APIs

```bash
gcloud projects create "$PROJECT"
gcloud config set project "$PROJECT"

gcloud services enable \
  storage.googleapis.com \
  bigquery.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com
```

The last two are for Workload Identity Federation, which the deploy workflow uses to authenticate without a long-lived key.

### 2. Create the GCS bucket

```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --location="$REGION" \
  --uniform-bucket-level-access

# Lifecycle: delete objects after 90 days
gcloud storage buckets update "gs://${BUCKET}" --lifecycle-file=<(cat <<EOF
{
  "rule": [{
    "action": {"type": "Delete"},
    "condition": {"age": 90}
  }]
}
EOF
)
```

The lifecycle rule keeps storage under the 5 GB free tier indefinitely. Without it, the bucket grows by ~100 MB per month forever.

### 3. Create the BigQuery dataset

```bash
bq mk --location="$REGION" --dataset "${PROJECT}:${DATASET}"
```

The location must match the Cloud Run region. A dataset in `US` and a service in `us-central1` are technically compatible, but queries cross the boundary and the error messages are unhelpful.

### 4. Create the Artifact Registry repository

```bash
gcloud artifacts repositories create local-llm-sentiment \
  --repository-format=docker \
  --location="$REGION" \
  --description="API images for Local LLM Sentiment Tracker"
```

Then add a cleanup policy via the Console or:

```bash
gcloud artifacts repositories set-cleanup-policies local-llm-sentiment \
  --location="$REGION" \
  --policy=- <<'EOF'
[
  {
    "name": "keep-recent",
    "action": {"type": "Keep"},
    "mostRecentVersions": {"keepCount": 2}
  },
  {
    "name": "delete-old",
    "action": {"type": "Delete"},
    "condition": {"tagState": "any", "olderThan": "30d"}
  }
]
EOF
```

**Immutable tags must be disabled.** Cleanup policies cannot delete tagged artifacts when immutability is on. The tag format (`:${GITHUB_SHA}`) makes immutability unnecessary anyway - every commit produces a distinct tag.

### 5. Create the deploy service account

```bash
SA_NAME=github-deploy
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA_NAME" \
  --display-name="GitHub Actions deploy"

for role in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor
do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$role" \
    --condition=None
done
```

| Role | Why |
| :--- | :--- |
| `run.admin` | Deploy Cloud Run services |
| `artifactregistry.writer` | Push images |
| `iam.serviceAccountUser` | Deploy a service that runs as the compute SA |
| `secretmanager.secretAccessor` | Read secret metadata during deploy |

`iam.serviceAccountUser` is the one people forget. Without it, `gcloud run services replace` fails with `Permission 'iam.serviceaccounts.actAs' denied`.

### 6. Configure Workload Identity Federation

This lets GitHub Actions authenticate to GCP without storing a JSON key.

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

gcloud iam workload-identity-pools create github \
  --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global \
  --workload-identity-pool=github \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Bind the pool to the deploy SA, scoped to your repo
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/OWNER/REPO"
```

Replace `OWNER/REPO` with your GitHub repository path.

The two values for GitHub secrets are now:

| Secret name | Value |
| :--- | :--- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/providers/github-provider` |
| `GCP_SERVICE_ACCOUNT` | `${SA_EMAIL}` |

Add them under **GitHub → Settings → Secrets and variables → Actions → New repository secret**.

### 7. Create the runtime service account permissions

The Cloud Run service runs as the default compute service account. Grant it the roles it needs:

```bash
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/bigquery.jobUser" \
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/bigquery.dataViewer" \
  --condition=None
```

The two-role split is intentional:

| Role | Grants | Why this, not more |
| :--- | :--- | :--- |
| `bigquery.jobUser` | `bigquery.jobs.create` | The API runs queries |
| `bigquery.dataViewer` | `bigquery.tables.getData` | The queries read data |

`roles/bigquery.user` and `roles/bigquery.dataEditor` would also work, but they include `datasets.create`, `tables.delete`, and `tables.updateData` - permissions a read-only API never needs. If the container is compromised, `jobUser` + `dataViewer` limits the damage to "run expensive queries," not "drop the Gold table."

### 8. Create the secrets

```bash
# Read values from .env
set -a
source <(tr -d '\r' < .env)
set +a

printf '%s' "$REDIS_URL"           | gcloud secrets create redis-url   --data-file=-
printf '%s' "$REDIS_TOKEN"         | gcloud secrets create redis-token --data-file=-
printf '%s' "$HUGGINGFACE_API_KEY" | gcloud secrets create hf-api-key  --data-file=-

unset REDIS_URL REDIS_TOKEN HUGGINGFACE_API_KEY

# Grant the runtime SA access to each
for secret in redis-url redis-token hf-api-key; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

Use `printf '%s'`, never `echo`. A trailing `\n` in a secret value causes authentication failures that are nearly impossible to debug. The `REDIS_URL` is the most likely victim - the client will connect to `redis://...\n` and fail with a generic connection error.

### 9. Provision the BigQuery tables

```bash
make bootstrap
```

This renders `infra/bigquery/*.sql.tmpl` with the environment variables and applies each with `bq query`. Two tables are created:

- `raw_posts` - the external table over GCS
- `gold_sentiment_predictions` - the ML-owned predictions table

The external table must exist before dbt can read Bronze, and the predictions table must exist before `dbt build` can resolve the `ml` source.

### 10. Load the seed

```bash
make seed
```

This runs `scripts/generate_model_list.py` to regenerate `dbt/seeds/models.csv` from `config/models.yaml`, then loads it into BigQuery with `dbt seed`.

## GitHub repository configuration

### Secrets

| Name | Purpose |
| :--- | :--- |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | OIDC provider resource name |
| `GCP_SERVICE_ACCOUNT` | Deploy service account email |
| `GCP_PROJECT_ID` | Project ID (used by scraper workflow) |
| `GCS_BUCKET_NAME` | Bucket name |
| `BQ_DATASET_NAME` | Dataset name |
| `BQ_DATASET_LOCATION` | Region |

### Variables

Non-sensitive values that differ per environment but do not need to be secret:

| Name | Value |
| :--- | :--- |
| `GCS_BUCKET_NAME` | `local-llm-sentiment-lake` |
| `BQ_DATASET_NAME` | `local_llm_sentiment_dataset` |
| `SENTIMENT_MODEL_ID` | `yangheng/deberta-v3-base-absa-v1.1` |
| `INFERENCE_BACKEND` | `huggingface` |

Variables are visible in the Actions log; secrets are masked. Config values belong in variables, credentials belong in secrets.

## CI/CD pipelines

### `scrape.yml`

```yaml
on:
  schedule:
    - cron: '43 5 * * *'
  workflow_dispatch:

jobs:
  scrape-and-transform:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-python@v7
        with:
          python-version: '3.11'
      - run: pip install -r scraper/requirements.txt
      - id: auth
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
      - run: python scraper/main.py
        env:
          REDDIT_RSS_URL: ${{ vars.REDDIT_RSS_URL }}
          GCP_PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}
          GCS_BUCKET_NAME: ${{ vars.GCS_BUCKET_NAME }}
      - run: dbt build --profiles-dir . --profile local_llm_sentiment
        working-directory: dbt
        env:
          GCP_PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}
          BQ_DATASET_NAME: ${{ vars.BQ_DATASET_NAME }}
          BQ_DATASET_LOCATION: ${{ vars.BQ_DATASET_LOCATION }}
```

`dbt build` runs seeds, models, and tests in DAG order. A failing test blocks downstream models from materializing, so bad data never reaches Gold.

### `api-deploy.yml`

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'api/**'
      - 'infra/cloud-run/api-service.yaml'
      - '.github/workflows/api-deploy.yml'
  workflow_dispatch:

env:
  REGISTRY: ${{ vars.GAR_REPO_LOCATION }}-docker.pkg.dev
  IMAGE_TAG: ${{ env.REGISTRY }}/${{ vars.GCP_PROJECT_ID }}/${{ vars.GAR_REPO_NAME }}/api:${{ github.sha }}

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - id: auth
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
      - uses: google-github-actions/setup-gcloud@v3
        with:
          project_id: ${{ vars.GCP_PROJECT_ID }}
      - uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: oauth2accesstoken
          password: ${{ steps.auth.outputs.access_token }}
      - uses: docker/build-push-action@v6
        with:
          context: ./api
          push: true
          tags: ${{ env.IMAGE_TAG }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - run: envsubst < infra/cloud-run/api-service.yaml > /tmp/service.yaml
        env:
          IMAGE_TAG: ${{ env.IMAGE_TAG }}
          GCP_PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}
          BQ_DATASET_NAME: ${{ vars.BQ_DATASET_NAME }}
          GAR_REPO_LOCATION: ${{ vars.GAR_REPO_LOCATION }}
          SENTIMENT_MODEL_ID: ${{ vars.SENTIMENT_MODEL_ID }}
          INFERENCE_BACKEND: ${{ vars.INFERENCE_BACKEND }}
      - id: deploy
        uses: google-github-actions/deploy-cloudrun@v3
        with:
          metadata: /tmp/service.yaml
          project_id: ${{ vars.GCP_PROJECT_ID }}
          region: ${{ vars.BQ_DATASET_LOCATION }}
      - run: echo "### Deployed to [${{ steps.deploy.outputs.url }}](${{ steps.deploy.outputs.url }})" >> "$GITHUB_STEP_SUMMARY"
```

### `ci.yml`

```yaml
on:
  push:
    branches: [main]
  pull_request:

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

The dbt job runs `dbt parse` only, with placeholder credentials. This validates YAML and reference resolution without connecting to BigQuery. Full `dbt test` runs in the scrape workflow, where credentials already exist.

The `dashboard` job runs `npm run build` because that is what Vercel runs. If CI passes and Vercel fails, the CI was lying - this closes that gap.

## Local deployment

For testing the image and Cloud Run flow without going through GitHub:

```bash
PROJECT=local-llm-sentiment
REGION=us-central1
TAG=manual-$(date +%s)

# Build
cd api
docker build -t ${REGION}-docker.pkg.dev/${PROJECT}/local-llm-sentiment/api:${TAG} .

# Push
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
docker push ${REGION}-docker.pkg.dev/${PROJECT}/local-llm-sentiment/api:${TAG}

# Render and deploy
cd ..
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/local-llm-sentiment/api:${TAG}" \
GCP_PROJECT_ID="$PROJECT" \
GCS_BUCKET_NAME="local-llm-sentiment-lake" \
BQ_DATASET_NAME="local_llm_sentiment_dataset" \
BQ_DATASET_LOCATION="$REGION" \
SENTIMENT_MODEL_ID="yangheng/deberta-v3-base-absa-v1.1" \
INFERENCE_BACKEND="huggingface" \
envsubst '${IMAGE} ${GCP_PROJECT_ID} ${GCS_BUCKET_NAME} ${BQ_DATASET_NAME} ${BQ_DATASET_LOCATION} ${SENTIMENT_MODEL_ID} ${INFERENCE_BACKEND}' \
  < infra/cloud-run/api-service.yaml > /tmp/service.yaml

gcloud run services replace /tmp/service.yaml --region="$REGION"
```

Alternatively, if you skip the service YAML and just want a quick deploy:

```bash
gcloud run deploy local-llm-sentiment-api \
  --image "${REGION}-docker.pkg.dev/${PROJECT}/local-llm-sentiment/api:${TAG}" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --env-vars-file=.env \
  --set-secrets="HUGGINGFACE_API_KEY=hf-api-key:latest,REDIS_URL=redis-url:latest,REDIS_TOKEN=redis-token:latest"
```

The service YAML path is preferred because it is what CI uses. Testing the exact same path locally ensures no surprises when the workflow runs.

## Vercel setup

1. Import the repository at [vercel.com/new](https://vercel.com/new).
2. Set **Root Directory** to `dashboard`.
3. Vercel detects Vite and sets the build command automatically.
4. Add the environment variable:

| Name | Value |
| :--- | :--- |
| `VITE_API_URL` | Your Cloud Run service URL |

5. Deploy.

`dashboard/vercel.json` handles the SPA routing rewrite. Without it, refreshing `/trend?model=Qwen` returns 404 because Vercel looks for a static file at that path.

## Post-deployment verification

```bash
URL=$(gcloud run services describe local-llm-sentiment-api \
  --region=us-central1 --format='value(status.url)')

# Health check
curl "$URL/health"
# {"status":"healthy","bigquery":"connected","redis":"connected","model":"ready"}

# Smoke test
curl "$URL/leaderboard?days=7" | jq '.ranking | length'
# A number greater than 0

# Cold start timing
time curl -s "$URL/health" > /dev/null
```

If `/health` reports `bigquery: error`, the runtime SA is missing a role. Check the Cloud Run logs:

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=local-llm-sentiment-api" \
  --limit=20 \
  --format="value(timestamp, textPayload)"
```

Common failures and their fixes are documented in [08_OPERATIONS.md](08_OPERATIONS.md).

## Rollback

Every deploy produces a revision. List them:

```bash
gcloud run revisions list \
  --service=local-llm-sentiment-api \
  --region=us-central1
```

Roll back by routing traffic to a previous revision:

```bash
gcloud run services update-traffic local-llm-sentiment-api \
  --region=us-central1 \
  --to-revisions=local-llm-sentiment-api-00042-abc=100
```

The SHA-tagged image for that revision is still in Artifact Registry (assuming the cleanup policy has not pruned it), so the rollback is complete and reproducible.
