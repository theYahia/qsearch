#!/usr/bin/env bash
# qsearch — one-command quickstart.
#
# Brings qsearch from a fresh clone to a green /health in a single command:
#   1. checks prerequisites (docker, docker compose, node) with actionable messages
#   2. seeds .env.local from .env.example if missing (never overwrites an existing one)
#   3. starts the infra services via docker compose (Meilisearch, Qdrant, SearXNG)
#   4. starts the qsearch node server (detached) and waits for /health to report ok
#   5. prints next steps + the local URL
#
# Idempotent: safe to re-run. Already-running services are reused, not duplicated.
# POSIX-friendly bash. Run from anywhere: `bash scripts/quickstart.sh`.
#
# Flags:
#   --no-server   Start only the docker infra; skip the node server + health wait.
#   --rebuild     `docker compose up -d --build` (force image/recreate).
#   -h | --help   Show usage.

set -euo pipefail

# ── Resolve project root (this script lives in <root>/scripts/) ───────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

# ── Config (override via env) ─────────────────────────────────────────────────
PORT="${PORT:-8080}"                       # qsearch node server port
HEALTH_URL="http://localhost:${PORT}/health"
RUNTIME_DIR="${ROOT_DIR}/data/quickstart"  # data/ is gitignored — keep runtime here
PID_FILE="${RUNTIME_DIR}/qsearch.pid"
LOG_FILE="${RUNTIME_DIR}/qsearch.log"
HEALTH_TIMEOUT="${QUICKSTART_HEALTH_TIMEOUT:-120}"   # seconds to wait for /health
INFRA_TIMEOUT="${QUICKSTART_INFRA_TIMEOUT:-120}"     # seconds to wait for compose health

START_SERVER=1
COMPOSE_UP_FLAGS=""

for arg in "$@"; do
  case "$arg" in
    --no-server) START_SERVER=0 ;;
    --rebuild)   COMPOSE_UP_FLAGS="--build" ;;
    -h|--help)
      # Print only the leading header block: stop at the first non-comment line
      # (the `set -euo pipefail` line) so section dividers below aren't included.
      awk 'NR==1 && /^#!/ {next} /^#/ {sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]:-$0}"
      exit 0
      ;;
    *)
      echo "qsearch quickstart: unknown argument '$arg' (try --help)" >&2
      exit 2
      ;;
  esac
done

# ── Pretty logging ────────────────────────────────────────────────────────────
log()  { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
ok()   { printf '  [ok] %s\n' "$*"; }
warn() { printf '  [warn] %s\n' "$*" >&2; }
die()  { printf '\n[x] %s\n' "$*" >&2; exit 1; }

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
# Resolve the docker compose invocation once: v2 plugin (`docker compose`) or the
# legacy v1 standalone (`docker-compose`). Stored in an array to call safely.
detect_compose() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    die "Docker Compose not found.
      Install the Compose plugin (ships with Docker Desktop) or the standalone binary:
      https://docs.docker.com/compose/install/"
  fi
}

check_prereqs() {
  step "Checking prerequisites"

  command -v docker >/dev/null 2>&1 || die "Docker not found.
      Install Docker Desktop (Win/macOS) or the engine (Linux): https://docs.docker.com/get-docker/"
  ok "docker found ($(docker --version 2>/dev/null | head -n1))"

  # The daemon must actually be running, not just the CLI installed.
  if ! docker info >/dev/null 2>&1; then
    die "Docker is installed but the daemon is not reachable.
      Start Docker Desktop (or 'sudo systemctl start docker') and re-run."
  fi
  ok "docker daemon is running"

  detect_compose
  ok "docker compose found (${COMPOSE[*]})"

  if [ "${START_SERVER}" -eq 1 ]; then
    command -v node >/dev/null 2>&1 || die "Node.js not found (needed to run the qsearch server).
      Install Node >= 20: https://nodejs.org/  — or pass --no-server to start infra only."
    # qsearch requires Node >= 20 (see package.json "engines").
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "${node_major}" -lt 20 ]; then
      die "Node $(node --version) is too old. qsearch needs Node >= 20. Upgrade: https://nodejs.org/"
    fi
    ok "node found ($(node --version))"
  fi

  # curl is used for the health poll; warn but fall back to wget if absent.
  if command -v curl >/dev/null 2>&1; then
    HTTP_GET=(curl -fsS --max-time 5)
    HAVE_HTTP=1
  elif command -v wget >/dev/null 2>&1; then
    HTTP_GET=(wget -q -T 5 -O -)
    HAVE_HTTP=1
  else
    warn "Neither curl nor wget found — cannot poll /health. Install curl to enable the health wait."
    HAVE_HTTP=0
  fi
}

# Fetch a URL to stdout (curl or wget). Returns non-zero on failure.
http_get() {
  "${HTTP_GET[@]}" "$1"
}

# ── 2. Seed .env.local ────────────────────────────────────────────────────────
seed_env() {
  step "Configuring environment (.env.local)"
  if [ -f "${ROOT_DIR}/.env.local" ]; then
    ok ".env.local already exists — keeping it (not overwritten)"
    return 0
  fi
  if [ ! -f "${ROOT_DIR}/.env.example" ]; then
    die ".env.example is missing — cannot seed .env.local. Restore it from the repo."
  fi
  cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env.local"
  ok "created .env.local from .env.example"
  log "Optional but recommended: set BRAVE_API_KEY in .env.local"
  log "  (BYOK, ~\$5/mo for ~1000 queries — https://brave.com/search/api/)"
  log "Without it, 'broad' sweeps still work via the local SearXNG container."
}

# ── 3. Start infra (docker compose) ───────────────────────────────────────────
start_infra() {
  step "Starting infrastructure (Meilisearch, Qdrant, SearXNG)"
  # shellcheck disable=SC2086  # COMPOSE_UP_FLAGS is intentionally word-split (may be empty)
  "${COMPOSE[@]}" up -d ${COMPOSE_UP_FLAGS}
  ok "compose up issued"
}

# Wait until every compose service reports healthy (services define healthchecks).
# Tolerant: if the compose version can't emit health status, fall back to the
# qsearch /health canary, which probes SearXNG/Meili end-to-end anyway.
wait_for_infra() {
  step "Waiting for infra containers to become healthy (up to ${INFRA_TIMEOUT}s)"
  local waited=0 unhealthy
  while [ "${waited}" -lt "${INFRA_TIMEOUT}" ]; do
    # Count services that are not yet healthy. Health column appears as
    # "(healthy)" / "(health: starting)" / "(unhealthy)" in `compose ps`.
    if ! unhealthy="$("${COMPOSE[@]}" ps 2>/dev/null)"; then
      warn "could not query compose status — skipping infra wait (qsearch /health will still verify reachability)"
      return 0
    fi
    # If no "health:" markers are present at all, the images may lack healthchecks
    # in this compose version; don't block on it.
    if ! printf '%s\n' "${unhealthy}" | grep -q 'health'; then
      warn "no health status reported by compose — skipping infra wait"
      return 0
    fi
    if ! printf '%s\n' "${unhealthy}" | grep -Eq 'health: starting|unhealthy'; then
      ok "all infra containers healthy"
      return 0
    fi
    sleep 3
    waited=$((waited + 3))
    printf '  ... %ss\n' "${waited}"
  done
  warn "infra not fully healthy after ${INFRA_TIMEOUT}s — continuing anyway."
  warn "inspect with: ${COMPOSE[*]} ps   and   ${COMPOSE[*]} logs"
}

# ── 4. Start qsearch node server + wait for /health ───────────────────────────
server_is_up() {
  [ "${HAVE_HTTP}" -eq 1 ] || return 1
  http_get "${HEALTH_URL}" >/dev/null 2>&1
}

start_server() {
  step "Starting qsearch server on :${PORT}"

  if server_is_up; then
    ok "qsearch already responding on ${HEALTH_URL} — reusing it"
    return 0
  fi

  # If a previous quickstart left a live PID, reuse rather than spawn a duplicate.
  if [ -f "${PID_FILE}" ]; then
    local old_pid
    old_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
    if [ -n "${old_pid}" ] && kill -0 "${old_pid}" 2>/dev/null; then
      ok "qsearch server already running (pid ${old_pid}) — waiting on it"
      return 0
    fi
    rm -f "${PID_FILE}"
  fi

  # Install dependencies if node_modules is absent (first run after clone).
  if [ ! -d "${ROOT_DIR}/node_modules" ]; then
    log "installing npm dependencies (first run)…"
    npm install
    ok "dependencies installed"
  else
    ok "node_modules present — skipping npm install"
  fi

  mkdir -p "${RUNTIME_DIR}"
  log "launching detached node server (logs → ${LOG_FILE})"
  # Detach so the script can return after /health is green. The server keeps
  # running in the background; stop it with the command printed at the end.
  nohup node "${ROOT_DIR}/src/server.js" >"${LOG_FILE}" 2>&1 &
  echo $! >"${PID_FILE}"
  ok "qsearch server started (pid $(cat "${PID_FILE}"))"
}

wait_for_health() {
  if [ "${HAVE_HTTP}" -eq 0 ]; then
    warn "skipping /health wait (no curl/wget). Verify manually: ${HEALTH_URL}"
    return 0
  fi
  step "Waiting for ${HEALTH_URL} (up to ${HEALTH_TIMEOUT}s)"
  local waited=0 body
  while [ "${waited}" -lt "${HEALTH_TIMEOUT}" ]; do
    if body="$(http_get "${HEALTH_URL}" 2>/dev/null)"; then
      case "${body}" in
        *'"status":"ok"'*|*'"status": "ok"'*)
          ok "qsearch is healthy"
          return 0
          ;;
      esac
    fi
    # Detect an early crash so we fail fast instead of polling a dead process.
    if [ "${START_SERVER}" -eq 1 ] && [ -f "${PID_FILE}" ]; then
      local pid
      pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
      if [ -n "${pid}" ] && ! kill -0 "${pid}" 2>/dev/null; then
        warn "qsearch server process exited early — last log lines:"
        tail -n 20 "${LOG_FILE}" 2>/dev/null || true
        die "qsearch failed to start. Full log: ${LOG_FILE}"
      fi
    fi
    sleep 2
    waited=$((waited + 2))
    printf '  ... %ss\n' "${waited}"
  done
  warn "qsearch did not report healthy within ${HEALTH_TIMEOUT}s."
  [ -f "${LOG_FILE}" ] && { warn "last log lines:"; tail -n 20 "${LOG_FILE}" 2>/dev/null || true; }
  die "Health check timed out. Inspect: ${HEALTH_URL} and ${LOG_FILE}"
}

# ── 5. Next steps ─────────────────────────────────────────────────────────────
print_next_steps() {
  step "qsearch is ready"
  cat <<EOF
  Local server : http://localhost:${PORT}
  Health       : ${HEALTH_URL}
  Corpus UI    : http://localhost:${PORT}/ui

  Try your first multi-engine sweep:
    curl -X POST "http://localhost:${PORT}/sweep?topic=my_first_sweep" \\
      -H "Content-Type: text/plain" \\
      --data-binary \$'t1|self-hosted search engine 2026\\n'

  Connect Claude Code over MCP (separate process, port 8081):
    npm run start:mcp

  Optional — local LLM for cleaned content + rerank (needs Ollama on :11434):
    ollama pull qwen2.5:7b-instruct    # ~5GB, used by /sweep_context
    ollama pull nomic-embed-text       # 274MB, embedding rerank
EOF
  if [ "${START_SERVER}" -eq 1 ] && [ -f "${PID_FILE}" ]; then
    cat <<EOF

  Server runs detached (pid $(cat "${PID_FILE}" 2>/dev/null || echo '?')).
    Logs : ${LOG_FILE}
    Stop : kill \$(cat "${PID_FILE}")
EOF
  fi

  # Surface the optional Ollama dependency state without failing on it.
  if [ "${HAVE_HTTP}" -eq 1 ]; then
    if http_get "${OLLAMA_URL:-http://localhost:11434}/api/tags" >/dev/null 2>&1; then
      ok "Ollama detected on ${OLLAMA_URL:-http://localhost:11434} (local LLM features available)"
    else
      log "Ollama not detected — search works without it (no cleaned_markdown / rerank)."
    fi
  fi
  printf '\n'
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  printf 'qsearch quickstart — bringing up the local search stack\n'
  check_prereqs
  seed_env
  start_infra
  wait_for_infra
  if [ "${START_SERVER}" -eq 1 ]; then
    start_server
    wait_for_health
  else
    log "--no-server: skipping node server + health wait (infra only)"
  fi
  print_next_steps
}

main "$@"
