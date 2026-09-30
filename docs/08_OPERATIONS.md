# Operations

Cost budgeting, monitoring, and troubleshooting for the free-tier deployment.

## Free tier math

Every component is sized against its platform's free tier. The binding constraints are highlighted.

| Service | Free tier | Expected usage | Headroom |
| :--- | :--- | :--- | :--- |
| **GitHub Actions** | 2,000 min/month (private), unlimited (public) | ~240 min/month | ~88% |
| **GCS storage** | 5 GB | ~100 MB growth/month, 90-day retention → ~300 MB steady | ~94% |
| **BigQuery storage** | 10 GB active | < 500 MB | ~95% |
| **BigQuery queries** | 1 TB/month | < 5 GB/month | ~99.5% |
| **Cloud Run requests** | 2M/month | ~10k/month | ~99.5% |
| **Cloud Run vCPU-s** | 180,000/month | ~10,000/month | ~94% |
| **Cloud Run GiB-s** | 360,000/month | ~5,000/month | ~98.6% |
| **Artifact Registry** | 500 MB | ~200 MB (2 images @ 100 MB) | ~50% |
| **Upstash Redis** | 10,000 commands/day | ~1,000/day | ~90% |
| **Hugging Face** | ~30,000 requests/month | ~4,000/month | ~86.6% |

Two constraints are worth understanding in detail: Artifact Registry storage and Cloud Run vCPU-seconds.

### Artifact Registry

The 500 MB free tier holds two API images at ~100 MB each. The cleanup policy keeps the two most recent versions and deletes everything else.

| Keep count | Storage | Free tier |
| :--- | :--- | :--- |
| 1 | ~100 MB | plenty headroom |
| **2** | **~200 MB** | 50% headroom |
| 3 | ~300 MB | risky |

**Immutable tags must be off.** With immutable tags enabled, the cleanup policy cannot delete tagged artifacts, and storage grows by 100 MB on every deploy until you manually intervene.

### Cloud Run vCPU-seconds

The instance is configured with `maxScale: 1`, `cpu: 1`, `memory: 512Mi`. The worst-case consumption is bounded:

```
1 vCPU × 2,592,000 seconds/month = 2,592,000 vCPU-seconds
```

The free tier provides 180,000. A determined attacker who keeps the service hot continuously would exhaust the allowance in:

```
180,000 / 1 vCPU = 180,000 seconds = 50 hours
```

50 hours of continuous traffic. This is the theoretical ceiling, and it requires an attacker to sustain the load for two full days. Cloud Run's edge absorbs volumetric attacks before they reach the container, so a simple script is unlikely to reach the ceiling. A distributed attack could.

If this becomes a concern:

1. **Reduce `timeoutSeconds`** from 120 to 30. A hanging request consumes vCPU for the full timeout window; a shorter window caps the damage.
2. **Add rate limiting** at the application level, using Redis `INCR` with a per-IP key and a 60-second TTL.
3. **Disable the public endpoint** and require authentication from the dashboard. This trades accessibility for cost safety.

None of these are necessary for a portfolio project. The `maxScale: 1` ceiling already caps the worst-case bill at a few cents.

### Upstash Redis

The free tier is 10,000 commands per day. A cache hit is one `GET`; a miss is one `GET` plus one `SET`. At the 6-hour TTL:

- Leaderboard: ~4 misses/day × 2 commands = 8 commands
- Post-count, trend, summary, search: similar
- Health check: no Redis usage
- Dashboard polling: 1 `GET /health` per 30 seconds = 2,880 health checks/day, but health does not touch Redis for reads

Total: under 1,000 commands per day in typical usage. The constraint only bites if the dashboard is open in many browser tabs simultaneously or if a script polls aggressively.

## Monitoring

There is no dedicated monitoring stack. The signals are:

| Signal | Where | Alert threshold |
| :--- | :--- | :--- |
| **Cloud Run error rate** | Cloud Logging | Any `5xx` in the last hour |
| **Cache hit rate** | Redis `INFO` | Below 80% suggests a TTL that is too short |
| **Backfill success rate** | Job log summary | `failed > 0` |
| **`/health` status** | Dashboard topbar | Any red dot |
| **dbt test failures** | Scrape workflow | Any failing test |
| **BigQuery bytes billed** | `INFORMATION_SCHEMA.JOBS` | Daily total over 50 GB |

The dashboard's `/health` endpoint is the primary operational view. A green topbar means all three dependencies are reachable.

### Checking BigQuery costs

```sql
SELECT
  DATE(creation_time) AS day,
  SUM(total_bytes_processed) / POW(1024, 3) AS gib_processed,
  COUNT(*) AS query_count
FROM `region-us-central1.INFORMATION_SCHEMA.JOBS_BY_PROJECT`
WHERE creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND job_type = 'QUERY'
GROUP BY day
ORDER BY day DESC;
```

At the current data volume, a full week of queries processes under 1 GB. The 1 TB monthly limit is not a concern.

### Checking Cloud Run usage

```bash
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/container/cpu/utilizations"' \
  --format='table(points[].value.doubleValue)'
```

Or in the Console: **Cloud Run → local-llm-sentiment-api → Metrics**. The relevant panels are **Request count**, **CPU utilization**, and **Instance count**.

An instance count that stays at 1 for hours is normal during active use. An instance count that stays at 1 with no traffic suggests a liveness probe failure or a scheduled job that is not terminating.

## Common failures

### The service returns `503 Service Unavailable`

**Symptom**: The first request after a period of inactivity returns 503.

**Cause**: Cold start. The container is starting, and the startup probe has not yet passed.

**Handling**: Retry after 3–5 seconds. The dashboard's TanStack Query client retries automatically.

**Prevention**: Set `minScale: 1` to keep one instance always warm. This costs money - a warm instance consumes vCPU seconds continuously. Not recommended for a portfolio project.

### `/health` reports `bigquery: error`

**Symptom**: The health endpoint responds, but the BigQuery dependency check fails.

**Cause**: The runtime service account is missing a role.

**Diagnosis**:

```bash
gcloud logging read \
  "resource.type=cloud_run_revision
   AND resource.labels.service_name=local-llm-sentiment-api
   AND severity>=ERROR" \
  --limit=10 \
  --format="value(textPayload)"
```

Look for `Access Denied: ... bigquery.jobs.create` or `... bigquery.tables.getData`.

**Fix**:

```bash
PROJECT=local-llm-sentiment
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/bigquery.jobUser" \
  --condition=None

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${SA}" \
  --role="roles/bigquery.dataViewer" \
  --condition=None
```

IAM changes take 30–60 seconds to propagate. No redeploy is needed.

### `/health` reports `redis: disconnected`

**Symptom**: The health endpoint responds, but Redis is unreachable.

**Cause**: Expired `REDIS_URL`, incorrect `REDIS_TOKEN`, or an Upstash outage.

**Impact**: Low. The API falls through to BigQuery on every request. Latency increases from ~15 ms to ~250 ms. The service continues to function.

**Fix**: Verify the credentials in the Upstash console against the Secret Manager values.

### Backfill stalls with rate limit errors

**Symptom**: The backfill job logs `429 Too Many Requests` from Hugging Face.

**Cause**: The free tier is rate-limited to a few hundred requests per hour. A backfill that processes thousands of rows exceeds this.

**Fix**: The job already sleeps `HF_THROTTLE_SECONDS` between requests. Increase it:

```python
HF_THROTTLE_SECONDS = 1.5  # was 0.5
```

At 1.5 seconds per request, 4,000 requests take 100 minutes. Slow but under the limit.

**Alternative**: Switch to the local backend for the backfill. `INFERENCE_BACKEND=local` removes the rate limit entirely.

### `dbt test` fails on `assert_no_orphan_predictions`

**Symptom**: The scrape workflow's dbt test step fails.

**Cause**: `config/models.yaml` was edited without running the backfill. The mention extraction produced new `mention_id` values, and old predictions are now orphans.

**Fix**:

```bash
make backfill
```

The backfill's `purge_orphan_predictions()` step deletes predictions that no longer correspond to a feature row, then scores the new mentions. Re-run `dbt test` to confirm.

### The dashboard shows stale data

**Symptom**: A new post does not appear in the leaderboard after several hours.

**Cause**: The GitHub Actions cron did not run, or the run failed.

**Diagnosis**:

```bash
gh run list --workflow=scrape.yml --limit=10
```

**Fix**: Trigger the workflow manually:

```bash
gh workflow run scrape.yml
```

### The dashboard 404s on refresh

**Symptom**: Refreshing a deep link like `/trend?model=Qwen` returns 404.

**Cause**: `dashboard/vercel.json` is missing the SPA rewrite rule, or Vercel's root directory is set to the repo root instead of `dashboard/`.

**Fix**: Verify the file exists at `dashboard/vercel.json` and contains:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

## Cost controls

### Hard ceilings already in place

| Control | Effect |
| :--- | :--- |
| Cloud Run `maxScale: 1` | At most one instance; worst case is a few cents |
| Cloud Run `timeoutSeconds: 120` | Caps the vCPU cost of a hanging request |
| BigQuery `partition_expiration_days = 90` | Deletes old partitions automatically |
| GCS lifecycle rule | Deletes raw JSONL after 90 days |
| Artifact Registry cleanup policy | Keeps two images |
| Redis 6-hour TTL | Reduces cache misses to a few per day |

### What is not capped

| Resource | Risk | Mitigation |
| :--- | :--- | :--- |
| BigQuery bytes scanned | A single malformed query could scan the whole table | Partition and cluster filters are in every query |
| Cloud Run vCPU-s | Sustained attack exhausts 180k in ~50 hours | Cloud Run edge absorbs volumetric attacks |
| GCS egress | Large downloads could exceed the 1 GB free egress | JSONL files are small; no public downloads |

### Setting a budget alert

Even on the free tier, a budget alert catches misconfiguration:

```bash
gcloud billing budgets create \
  --billing-account=BILLING_ACCOUNT_ID \
  --display-name="Local LLM Sentiment Tracker" \
  --budget-amount=1USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=100
```

Alerts fire at $0.50 and $1.00. They do not stop spending - Google Cloud has no hard spend cap - but they notify before the bill grows.

Find your billing account:

```bash
gcloud billing accounts list
```

## Routine maintenance

| Task | Frequency | Command |
| :--- | :--- | :--- |
| Rotate Hugging Face key | Every 90 days | `printf '%s' "$NEW_KEY" \| gcloud secrets versions add hf-api-key --data-file=-` |
| Check Artifact Registry storage | Monthly | `gcloud artifacts repositories describe local-llm-sentiment --location=us-central1` |
| Check BigQuery bytes billed | Monthly | `SELECT SUM(total_bytes_processed) FROM ... INFORMATION_SCHEMA.JOBS` |
| Review Cloud Run instance count | Monthly | Console → Cloud Run → Metrics |
| Purge orphan predictions | After each model-list edit | `make backfill` |
| Prune old GCS objects | Automatic | Lifecycle rule |
| Prune old BigQuery partitions | Automatic | `partition_expiration_days` |

## Disaster recovery

The system can be reconstructed from the repo and the environment:

| Scenario | Recovery |
| :--- | :--- |
| Cloud Run service deleted | `make deploy` rebuilds from the last image; service YAML restores config |
| BigQuery dataset deleted | `make bootstrap` recreates tables; `dbt build` rebuilds Silver and Gold from GCS |
| GCS bucket deleted | Re-run the scraper for recent data; older data is lost |
| Redis flushed | Cache refills on the next request; no data loss |
| Deploy SA key compromised | Rotate the WIF provider; no long-lived key exists |
| Runtime SA compromised | Rotate secrets; revoke roles; the blast radius is `bigquery.jobUser` + `dataViewer` |

The only data that cannot be reconstructed is the raw Bronze data in GCS. If it is deleted, the scraper must re-fetch from Reddit, which only surfaces recent posts. This is the one single point of failure.

To mitigate, consider a secondary GCS bucket in a different region with object versioning enabled. This exceeds the free tier (duplicate storage), so it is not part of the default setup.

## Operational runbook

### Daily

Nothing. The system runs on autopilot.

### Weekly

- Check the scrape workflow ran 28 times in the last 7 days (`gh run list --workflow=scrape.yml`)
- Check `/health` from the dashboard

### Monthly

- Check BigQuery bytes processed against the 1 TB limit
- Check Artifact Registry storage against the 500 MB limit
- Check Cloud Run instance count and vCPU usage

### After each model-list edit

- Run `make generate && make seed && make dbt && make backfill`
- Verify `dbt test` passes, especially `assert_no_orphan_predictions`

### After each deploy

- Verify `/health` reports all three dependencies green
- Smoke test `/leaderboard?days=7`
- Check the Vercel dashboard loads and the health dots are green
