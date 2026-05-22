#!/usr/bin/env bash
# economy_summary.sh — pull the qsearch /economy_report for a sprint (rd278 harness).
# Usage:
#   scripts/economy_summary.sh <sprint_id> [json|markdown]
#   QSEARCH_URL=http://localhost:8080 scripts/economy_summary.sh saddle_uterus markdown
#
# Captures only the qsearch-routed portion (broad/scholarly/ru + cached_sweep + academic).
# Client-side Brave web/context calls from brave_sweep.py are NOT here — add them from the
# sweep's _sweep_log.json. See docs/TOKEN_ECONOMY_DOGFOOD.md.
set -euo pipefail

SPRINT_ID="${1:-}"
FORMAT="${2:-markdown}"
BASE="${QSEARCH_URL:-http://localhost:8080}"

if [ -z "$SPRINT_ID" ]; then
  echo "usage: $0 <sprint_id> [json|markdown]" >&2
  exit 2
fi

if ! curl -s --connect-timeout 3 "$BASE/health" -o /dev/null; then
  echo "qsearch not reachable at $BASE — start it: docker compose --env-file .env.local up -d && node src/server.js" >&2
  exit 1
fi

curl -s "$BASE/economy_report?sprint_id=${SPRINT_ID}&topic=${SPRINT_ID}&format=${FORMAT}"
echo
