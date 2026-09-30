#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "[1/2] Generating seed..."
python "$SCRIPT_DIR/generate_model_list.py"

echo "[2/2] Loading seed into BigQuery..."
(cd "$ROOT/dbt" && dbt seed \
  --project-dir . \
  --profiles-dir . \
  --profile local_llm_sentiment \
  --select models)

echo "Done."
