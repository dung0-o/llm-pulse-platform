#!/usr/bin/env bash
set -euo pipefail

set -a && source .env && set +a

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${BQ_DATASET_NAME:?BQ_DATASET_NAME is required}"
: "${GCS_BUCKET_NAME:?GCS_BUCKET_NAME is required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
TMPL_DIR="$ROOT/infra/bigquery"
OUT_DIR="$TMPL_DIR/.rendered"

mkdir -p "$OUT_DIR"

for tmpl in "$TMPL_DIR"/*.sql.tmpl; do
  name="$(basename "${tmpl%.tmpl}")"
  rendered="$OUT_DIR/$name"

  envsubst < "$tmpl" > "$rendered"
  echo "Applying $name..."
  bq query --use_legacy_sql=false < "$rendered"
done

echo "Done."
