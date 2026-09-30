#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

echo "[1/3] Scraping..."
(cd "$ROOT" && python scraper/main.py)

echo "[2/3] Running dbt..."
(cd "$ROOT/dbt" && dbt build \
  --project-dir . \
  --profiles-dir . \
  --profile local_llm_sentiment)

echo "[3/3] Backfilling sentiment..."
(cd "$ROOT/api" && python -m jobs.backfill)

echo "Done."
