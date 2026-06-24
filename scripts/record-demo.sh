#!/usr/bin/env bash
# record-demo.sh — record the qsearch terminal demo to assets/demo.gif (or .cast).
#
# Scenario recorded (see scripts/demo-flow.sh): quickstart (health) → search
# (multi-engine /sweep) → verify (citation /verify). The README embeds the result
# at assets/demo.gif.
#
# Two backends, auto-detected (prefers VHS — it makes a clean, deterministic GIF):
#   1. vhs        (charmbracelet/vhs) — runs scripts/demo.tape → assets/demo.gif
#   2. asciinema  — records scripts/demo-flow.sh → assets/demo.cast,
#                   then agg (if present) → assets/demo.gif
#
# Usage:
#   bash scripts/record-demo.sh            # auto: vhs if present, else asciinema
#   bash scripts/record-demo.sh --vhs      # force vhs
#   bash scripts/record-demo.sh --asciinema
#   bash scripts/record-demo.sh --no-check # skip the "is :8080 up?" preflight
#
# Run AFTER the server is live:  npm start  (and `docker compose up -d` for real
# /sweep results, Ollama for /verify). The recorder does not boot anything — a GIF
# needs a real TTY and live endpoints.

set -euo pipefail

# --- locate repo root regardless of where the script is called from ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

QS_BASE="${QS_BASE:-http://localhost:8080}"
OUT_DIR="assets"
TAPE="scripts/demo.tape"
FLOW="scripts/demo-flow.sh"

backend="auto"
do_check=1
for arg in "$@"; do
  case "$arg" in
    --vhs)       backend="vhs" ;;
    --asciinema) backend="asciinema" ;;
    --no-check)  do_check=0 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
  esac
done

c_reset=$'\033[0m'; c_red=$'\033[31m'; c_green=$'\033[32m'; c_yellow=$'\033[33m'; c_dim=$'\033[2m'
info() { printf '%s>>%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%s!!%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
die()  { printf '%sxx%s %s\n' "$c_red" "$c_reset" "$*" >&2; exit 1; }

mkdir -p "$OUT_DIR"
[ -f "$FLOW" ] || die "missing $FLOW (the demo scenario)"

# --- preflight: server reachable? (warn, do not hard-fail — user may know best) ---
if [ "$do_check" -eq 1 ]; then
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 3 "$QS_BASE/health" >/dev/null 2>&1; then
      info "qsearch is up at $QS_BASE — recording live endpoints"
      # Act 3 needs the /verify route. An older running process may predate it
      # (source has it, but the live server was started before the verifier landed)
      # → it answers 404. Catch that here so a stale daemon doesn't waste a take.
      vcode="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 \
        -X POST "$QS_BASE/verify" -H 'Content-Type: application/json' \
        -d '{"claim":"preflight probe","url":"https://example.com"}' 2>/dev/null || echo 000)"
      if [ "$vcode" = "404" ]; then
        warn "$QS_BASE/verify returns 404 — the running server predates the /verify route."
        warn "Restart it from current source so the verify act records:  (Ctrl-C) then  npm start"
        warn "Continuing in 3s anyway — the verify act will show an error frame."
        sleep 3
      fi
    else
      warn "qsearch did not answer $QS_BASE/health."
      warn "Start it first so the demo shows real data:"
      warn "    docker compose up -d        # Meilisearch + Qdrant + SearXNG"
      warn "    npm start                   # qsearch on :8080"
      warn "    (Ollama qwen2.5:14b-instruct for /verify; else verdict = Error)"
      warn "Continuing in 3s anyway — Ctrl-C to abort, or pass --no-check to silence."
      sleep 3
    fi
  else
    warn "curl not found — skipping the server preflight."
  fi
fi

# --- backend resolution ------------------------------------------------------
have() { command -v "$1" >/dev/null 2>&1; }

record_vhs() {
  [ -f "$TAPE" ] || die "missing $TAPE (VHS scenario)"
  # vhs shells out to ttyd + ffmpeg; surface a precise message if either is absent.
  local miss=""
  have ttyd   || miss="$miss ttyd"
  have ffmpeg || miss="$miss ffmpeg"
  if [ -n "$miss" ]; then
    die "vhs needs:$miss on PATH.
    Homebrew:  brew install ttyd ffmpeg
    scoop:     scoop install ttyd ffmpeg
    (vhs installs them as deps via brew/scoop; standalone binaries miss them.)"
  fi
  info "recording with vhs → $OUT_DIR/demo.gif"
  vhs "$TAPE"
  info "done: $OUT_DIR/demo.gif"
}

record_asciinema() {
  info "recording with asciinema → $OUT_DIR/demo.cast"
  # --overwrite so re-runs are idempotent; -c runs the scenario non-interactively.
  asciinema rec "$OUT_DIR/demo.cast" --overwrite --cols 120 --rows 34 \
    -c "bash $FLOW"
  info "done: $OUT_DIR/demo.cast"
  if have agg; then
    info "converting cast → gif with agg → $OUT_DIR/demo.gif"
    agg --theme asciinema --font-size 18 "$OUT_DIR/demo.cast" "$OUT_DIR/demo.gif"
    info "done: $OUT_DIR/demo.gif"
  else
    warn "agg not found — produced $OUT_DIR/demo.cast only (no GIF)."
    warn "Make a GIF with:  cargo install --git https://github.com/asciinema/agg"
    warn "             then: agg $OUT_DIR/demo.cast $OUT_DIR/demo.gif"
    warn "Or embed the cast directly (see docs/launch/README-demo-embed.md)."
  fi
}

case "$backend" in
  vhs)       have vhs       || die "vhs not installed. Install: brew install vhs  |  scoop install vhs  |  go install github.com/charmbracelet/vhs@latest"
             record_vhs ;;
  asciinema) have asciinema || die "asciinema not installed. Install: brew install asciinema  |  pipx install asciinema  |  pip install asciinema"
             record_asciinema ;;
  auto)
    if have vhs; then
      record_vhs
    elif have asciinema; then
      warn "vhs not found — falling back to asciinema."
      record_asciinema
    else
      die "Neither vhs nor asciinema is installed.

  Recommended (clean GIF, one command):
    brew install vhs          # macOS / Linuxbrew  (pulls ttyd + ffmpeg)
    scoop install vhs ttyd ffmpeg   # Windows
    go install github.com/charmbracelet/vhs@latest   # needs ttyd + ffmpeg on PATH too
  then re-run:  bash scripts/record-demo.sh

  Alternative (cast, optional GIF via agg):
    brew install asciinema    # or: pipx install asciinema
    then re-run:  bash scripts/record-demo.sh

  Docs: https://github.com/charmbracelet/vhs  |  https://docs.asciinema.org"
    fi ;;
esac

echo
info "Next: open the recording and embed it."
printf '%s   - GIF lives at %s/demo.gif (already referenced by the README block).\n' "$c_dim" "$OUT_DIR"
printf '   - If you only have a .cast, see docs/launch/README-demo-embed.md for options.%s\n' "$c_reset"
