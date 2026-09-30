#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"

cleanup() {
  kill 0 || true
}
trap cleanup EXIT INT TERM

echo "Starting FastAPI on :8000..."
(cd "$ROOT" && python api/main.py) &

echo "Starting Vite on :5173..."
(cd "$ROOT/dashboard" && npm run dev) &

wait
