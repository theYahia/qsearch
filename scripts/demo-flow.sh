#!/usr/bin/env bash
# demo-flow.sh — the on-screen scenario for the qsearch terminal demo.
#
# This is the single source of truth for *what the demo shows*. Both the VHS
# recorder (scripts/demo.tape) and the asciinema recorder (scripts/record-demo.sh)
# invoke this file, so the GIF/cast and a plain `bash scripts/demo-flow.sh` run
# stay identical.
#
# Scenario (three acts, matching the README's pitch):
#   1. quickstart  — qsearch is up (health check on :8080)
#   2. search      — POST /sweep, multi-engine attribution (engines[] + count)
#   3. verify      — POST /verify, does the cited source actually support a claim?
#
# Prereqs (the demo does NOT start these — record after `npm start` is live):
#   - qsearch HTTP server on http://localhost:8080  (npm start)
#   - docker compose up -d  (Meilisearch + Qdrant + SearXNG) for real /sweep results
#   - Ollama with qwen2.5:14b-instruct for /verify (else verdict = Error, still shown)
#
# Tunables:
#   QS_BASE        base URL                  (default http://localhost:8080)
#   QS_TYPE_DELAY  seconds between "typed" commands for readability (default 0.4)
#   QS_QUERY       the search query          (default: self-hosted vector database 2026)
#   QS_CLAIM       the claim to verify       (default: a real, checkable assertion)
#   QS_CLAIM_URL   the source URL to verify against

set -u

QS_BASE="${QS_BASE:-http://localhost:8080}"
QS_TYPE_DELAY="${QS_TYPE_DELAY:-0.4}"
QS_QUERY="${QS_QUERY:-self-hosted search engine 2026}"
QS_CLAIM="${QS_CLAIM:-Qdrant is written in Rust.}"
QS_CLAIM_URL="${QS_CLAIM_URL:-https://github.com/qdrant/qdrant}"

# --- tiny presentation helpers (no external deps) ----------------------------
c_reset=$'\033[0m'; c_dim=$'\033[2m'; c_cyan=$'\033[36m'; c_green=$'\033[32m'
c_yellow=$'\033[33m'; c_bold=$'\033[1m'

# Print a prompt + the command as if typed, then run it.
run() {
  printf '%s$%s %s%s%s\n' "$c_green" "$c_reset" "$c_cyan" "$*" "$c_reset"
  sleep "$QS_TYPE_DELAY"
  eval "$*"
  echo
}

say() { printf '%s# %s%s\n' "$c_dim" "$*" "$c_reset"; }
hdr() { printf '\n%s%s%s\n' "$c_bold$c_yellow" "$*" "$c_reset"; }

# jq is optional — fall back to python3, then to raw cat, so the demo never dies.
pretty() {
  if command -v jq >/dev/null 2>&1; then jq "$@"
  elif command -v python3 >/dev/null 2>&1; then python3 -c 'import sys,json;print(json.dumps(json.load(sys.stdin),indent=2)[:1200])'
  else cat
  fi
}

# -----------------------------------------------------------------------------
clear 2>/dev/null || true
printf '%s  qsearch — full content + multi-engine provenance, owned by you%s\n' "$c_bold" "$c_reset"
say  "running locally on $QS_BASE — no data leaves the machine"

# --- ACT 1: quickstart -------------------------------------------------------
hdr "1) quickstart — is it up?"
run "curl -s $QS_BASE/health | pretty ."

# --- ACT 2: search (the headline: which engines agreed) ----------------------
hdr "2) search — multi-engine attribution"
say "one query, fanned out to Bing + DuckDuckGo + Brave + Qwant via SearXNG"
run "printf 't1|%s\\n' \"$QS_QUERY\" | curl -s -X POST \"$QS_BASE/sweep?topic=demo\" -H 'Content-Type: text/plain' --data-binary @- | head -24"
say "each result carries engines[] + count — trust signal baked into the data,"
say "not a ranked list that hides which engines actually surfaced the URL."

# --- ACT 3: verify (the differentiator: does the cite support the claim) ------
hdr "3) verify — does the source actually back the claim?"
say "claim: \"$QS_CLAIM\""
say "cited: $QS_CLAIM_URL"
run "curl -s -X POST $QS_BASE/verify -H 'Content-Type: application/json' -d '{\"claim\":\"'\"$QS_CLAIM\"'\",\"url\":\"'\"$QS_CLAIM_URL\"'\"}' | pretty ."
say "verdict ∈ Supported | Partial | Unsupported | Fabricated | Error,"
say "with the verbatim excerpt so an agent (or you) can audit the citation."

hdr "done — full pitch: github.com/theYahia/qsearch"
sleep 1
