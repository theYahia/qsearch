# Phase H.2 — Publish qsearch to MCP Registry (handoff plan)

> **Self-contained plan for another Claude session/model to execute.**
>
> **Project root:** `D:\Yahia\active\qsearch`
> **Goal:** Get `io.github.theyahia/qsearch` listed at `registry.modelcontextprotocol.io` so Claude Code, Claude Desktop, and any spec-compliant MCP client can discover qsearch.
> **Plan written:** 2026-04-28 (verified against `modelcontextprotocol/registry` main branch)
> **Execute window:** Fri 2026-05-01 (setup + dry-run) → Sun 2026-05-03 (publish)
> **Hard deadline:** Mon 2026-05-04 EOD UTC (Show HN is Tue 2026-05-05 14:00 UTC).

## Why this matters

The official `modelcontextprotocol/servers` GitHub repo **does not accept new server PRs anymore** (verified Phase F research). The only path to discovery in Claude Code/Desktop is `registry.modelcontextprotocol.io` via the `mcp-publisher` CLI. If we don't publish before launch:
- Show HN viewers can't `npm install`-style discover qsearch
- Claude Code's MCP browser won't find it
- We lose the "first pre-launch traffic" amplification window

The registry hit **API freeze (v0.1)** on 2025-10-24 — stable, safe to publish.

## What's verified (sources of truth read 2026-04-28)

| Fact | Source URL |
|------|------------|
| Install via prebuilt binary (Windows PowerShell), Go not required | `github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx` |
| Schema URL: `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` | `github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md` |
| Auth via GitHub device flow (not OAuth/OIDC redirect) | quickstart.mdx |
| Namespace pattern: `io.github.<username>/<server-name>` (lowercase) | quickstart.mdx |
| Transport types: `stdio`, `streamable-http`, `sse`, `http` | server-json/generic-server-json.md |
| Required fields: `$schema`, `name`, `version` | server-json/generic-server-json.md |
| Optional: `description`, `title`, `websiteUrl`, `repository`, `packages`, `remotes`, `_meta` | server-json/generic-server-json.md |

⚠️ **Re-verify at execution time** — schema may evolve. Always read latest `quickstart.mdx` and the schema URL printed by the CLI's `init` command.

## Pre-flight checks

Run these BEFORE attempting anything else:

```bash
# 1. qsearch.pro production is healthy and on v0.4.0
curl -s https://qsearch.pro/health | jq '.version'
# MUST return: "0.4.0"

# 2. /skill.md no longer contains QVAC text
curl -s https://qsearch.pro/skill.md | grep -ci "qvac\|qwen3\|0\.2\.2"
# MUST return: 0

# 3. /mcp endpoint accessible (this is what the registry will list as "remotes[].url")
curl -sf -X POST https://qsearch.pro/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}' \
  -o /dev/null -w "HTTP %{http_code}\n"
# MUST return: HTTP 200 (or 202)

# 4. GitHub repo exists and is public
curl -sf -o /dev/null -w "%{http_code}" https://api.github.com/repos/theYahia/qsearch
# MUST return: 200

# 5. Local qsearch repo is at commit ≥4fcafe5 (Phase G shipped)
cd /d/Yahia/active/qsearch && git log --oneline -1
# Verify hash matches main on GitHub
```

If any check fails — **stop and escalate**. Do not proceed.

## Step 1 — Install mcp-publisher CLI (Windows, no Go required)

The user runs Windows. Use the prebuilt binary, NOT `make publisher` from source.

### PowerShell (preferred):

```powershell
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile "$env:TEMP\mcp-publisher.tar.gz"
cd $env:USERPROFILE\bin   # or any dir on PATH; create if missing: New-Item -ItemType Directory -Path $env:USERPROFILE\bin -Force
tar xf $env:TEMP\mcp-publisher.tar.gz mcp-publisher.exe
Remove-Item $env:TEMP\mcp-publisher.tar.gz
.\mcp-publisher.exe --help
```

### Verify install

```powershell
mcp-publisher --help
# Expected: usage info listing init, login, publish subcommands
mcp-publisher --version
# Capture version — log it for retro
```

### Failure modes for Step 1

| Symptom | Action |
|---------|--------|
| `Invoke-WebRequest` fails with 404 | GitHub release tag changed — visit `https://github.com/modelcontextprotocol/registry/releases/latest` and download manually |
| `tar` not found on Windows | Use `Expand-Archive` (PowerShell native) or 7-Zip; `tar` is built-in on Win10+ but may be disabled |
| `mcp-publisher` not in PATH after extract | Add `$env:USERPROFILE\bin` to PATH or call with absolute path |
| Antivirus blocks download | Whitelist GitHub releases domain or use git clone + `make publisher` (requires Go 1.24.x) |

## Step 2 — Initialize and edit server.json

```bash
cd /d/Yahia/active/qsearch
mcp-publisher init
```

This creates a stub `server.json`. **Replace its contents** with the verified spec below.

### Final `server.json` for qsearch

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.theyahia/qsearch",
  "title": "qsearch",
  "description": "Open-source search layer for AI agents with multi-engine provenance, trust corpus, and full-page content. Self-hostable, BYOK, MCP-native.",
  "version": "0.4.0",
  "websiteUrl": "https://qsearch.pro",
  "repository": {
    "url": "https://github.com/theYahia/qsearch",
    "source": "github"
  },
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://qsearch.pro/mcp"
    }
  ]
}
```

### Important details

- **`name`: lowercase** `io.github.theyahia/qsearch` — GitHub username case is folded to lowercase in the namespace per quickstart examples (verified `my-username` → `io.github.my-username/...`). If publish fails with "name doesn't match auth username" — try `io.github.theYahia/qsearch` (preserve case) as fallback. The registry decides — re-read the error.
- **`version`: 0.4.0** must match `package.json` (re-check before publish: `node -e "console.log(require('./package.json').version)"`).
- **`websiteUrl`** vs `homepage` — schema as of 2025-12-11 uses `websiteUrl` (camelCase). If validation rejects, try `homepage`.
- **`repository.source`** must be `"github"` for our case (other valid: `"gitlab"`, `"git"`).
- **`remotes[].type`** is `"streamable-http"` because `src/mcp-http.js` uses `StreamableHTTPServerTransport`. Do NOT use `"http"` (that's for plain HTTP without streaming) or `"sse"` (different transport).
- **No `packages[]`** — qsearch is not published to npm. We're a remote-only MCP server. Per quickstart examples, `remotes` alone is valid.

### Validate locally before publishing

```bash
# JSON syntax
cat server.json | jq . > /dev/null && echo "JSON ok"

# Schema validation (CLI may have its own validate command — check)
mcp-publisher --help | grep -i validate
# If validate exists:
mcp-publisher validate server.json
# Else: skip — publish itself validates server-side
```

## Step 3 — Login via GitHub device flow

```bash
mcp-publisher login github
```

This will:
1. Print a URL like `https://github.com/login/device` and a 6-character code
2. Open the URL in browser, paste code, click Authorize
3. Token gets saved locally (typically `~/.config/mcp-publisher/credentials.json` or `%APPDATA%\mcp-publisher\credentials.json` on Windows)

### Verify auth succeeded

```bash
# CLI may have a whoami/status command — check
mcp-publisher --help | grep -iE "whoami|status|me"
# If found, run it to confirm authenticated user matches GitHub username 'theYahia'
```

### Failure modes for Step 3

| Symptom | Action |
|---------|--------|
| Browser doesn't open | Manual: copy URL, paste in browser, enter code |
| "User not authorized" | Verify GitHub account signed-in is `theYahia` (not personal). Try logout + relogin |
| Token saved to wrong location | Check `~/.config/mcp-publisher/` and `%APPDATA%/` — wipe stale tokens, re-login |
| Multiple GitHub accounts | Sign OUT of all GitHub sessions in browser before running login |

## Step 4 — Publish

⚠️ **First, do a DRY RUN if the CLI supports it:**

```bash
mcp-publisher --help | grep -iE "dry-run|--check"
# If --dry-run flag exists:
mcp-publisher publish --dry-run
```

### Real publish

```bash
cd /d/Yahia/active/qsearch
mcp-publisher publish
# Expected output: "Published io.github.theyahia/qsearch v0.4.0" or similar success line
# CAPTURE the timestamp and any returned ID — paste into commit message
```

## Step 5 — Verify on registry (3 checks from clean session)

```bash
# 1. Search query
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=qsearch" | jq '.servers[]? | select(.name | test("qsearch")) | {name, version, websiteUrl}'
# Expected: object with name="io.github.theyahia/qsearch", version="0.4.0"

# 2. Direct fetch by name (URL-encode the slash)
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.theyahia%2Fqsearch" | jq .
# Expected: full server.json content echoed back

# 3. From browser (incognito) — visit registry website if/when public-facing UI exists
# As of 2026-04-28, no public-facing search UI confirmed; API is the source of truth.
```

If all 3 pass — publish is complete.

## Step 6 — Commit server.json to qsearch repo

```bash
cd /d/Yahia/active/qsearch
git add server.json
git commit -m "feat: Phase H.2 — publish to MCP Registry as io.github.theyahia/qsearch v0.4.0"
git push origin main
```

This makes the namespace + manifest discoverable on the GitHub side too.

## Step 7 — Update README with MCP Registry badge

After successful publish, add to `README.md` near the top badges:

```markdown
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.theyahia%2Fqsearch-8b5cf6.svg)](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.theyahia%2Fqsearch)
```

Commit:
```bash
git add README.md && git commit -m "docs: add MCP Registry badge" && git push
```

## Failure recovery

### Namespace already taken

Extremely unlikely (qsearch is novel naming) but if `io.github.theyahia/qsearch` returns "already exists":
1. Check existing entry — is it ours from a previous attempt? If yes, version-bump and re-publish.
2. If genuine collision (someone else published earlier) — fallback names in priority order:
   - `io.github.theyahia/qsearch-mcp`
   - `io.github.theyahia/qsearch-server`
   - `pro.qsearch/qsearch` (custom domain, requires DNS TXT verification)

### Publish 5xx

```bash
# Wait 5 min, retry once
sleep 300 && mcp-publisher publish

# If still failing, check status
curl -s https://registry.modelcontextprotocol.io/v0.1/health
# Or visit https://github.com/modelcontextprotocol/registry/issues for outage reports
```

### Schema validation fails

The schema URL hardcoded in server.json (`2025-12-11`) may be outdated by execution time. Re-verify:
```bash
curl -s https://github.com/modelcontextprotocol/registry/raw/main/docs/reference/server-json/generic-server-json.md | grep -oE 'https://static\.modelcontextprotocol\.io/schemas/[0-9-]+/server\.schema\.json' | head -1
```
If different — update `$schema` field in server.json.

### Auth token expired (publish "401 unauthorized")

```bash
mcp-publisher logout 2>/dev/null || rm -f ~/.config/mcp-publisher/credentials.json
mcp-publisher login github
mcp-publisher publish
```

## Verification checklist (sign-off)

- [ ] `mcp-publisher --version` prints a version
- [ ] `server.json` exists in qsearch repo root, validated locally
- [ ] `mcp-publisher login github` succeeded
- [ ] `mcp-publisher publish` returned success
- [ ] `curl https://registry.modelcontextprotocol.io/v0.1/servers?search=qsearch` returns the entry
- [ ] `server.json` committed and pushed to qsearch main
- [ ] README has MCP Registry badge
- [ ] Phase H.2 result logged in `MEMORY.md` (project memory)

## Known unknowns (resolve at execution time)

1. **Exact CLI subcommand names** — quickstart says `init`, `login`, `publish`. Always run `mcp-publisher --help` first to confirm.
2. **Username case folding** — try lowercase first (`theyahia`), fallback to original case (`theYahia`).
3. **Schema URL date** — hardcoded `2025-12-11` may have rolled forward. Re-verify before publish.
4. **`websiteUrl` vs `homepage`** — schema as of 2025-12-11 uses `websiteUrl`. If publish rejects, swap.
5. **Whether `validate` subcommand exists** — quickstart doesn't mention it. Server-side validation will catch issues.

## Out of scope (do NOT do in Phase H.2)

- ❌ Don't bump qsearch version to 0.4.1+ for the publish — match what's in package.json
- ❌ Don't publish multiple test entries to the registry (each version-bump is permanent)
- ❌ Don't add `packages[]` for npm — we're not on npm, this would be lying
- ❌ Don't publish before Sun 2026-05-03 — preserves "fresh listing" signal for HN week
- ❌ Don't tweet about the registry listing until after Tue 2026-05-05 HN submission

## After H.2

Update `docs/launch-calendar.md` line ~28:
```diff
- - [ ] **Publish to MCP Registry** via `mcp-publisher` CLI (with GitHub OIDC auth). Verify listing live at registry.modelcontextprotocol.io.
+ - [x] **Published to MCP Registry** as io.github.theyahia/qsearch v0.4.0 on 2026-05-03 — verified live.
```

Then continue with H.5 (long-form blog) and Phase I (launch week per `docs/launch-calendar.md`).

---

## Quick command reference (TL;DR)

```bash
# 1. Install (Windows PowerShell)
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq "Arm64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_windows_$arch.tar.gz" -OutFile "$env:TEMP\mcp-publisher.tar.gz"
tar xf $env:TEMP\mcp-publisher.tar.gz -C $env:USERPROFILE\bin

# 2. Init + edit server.json
cd D:\Yahia\active\qsearch
mcp-publisher init
# (Replace generated server.json with verified spec from Step 2 above)

# 3. Login + publish
mcp-publisher login github
mcp-publisher publish

# 4. Verify
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=qsearch" | jq

# 5. Commit + push + README badge
git add server.json README.md && git commit -m "feat: Phase H.2 — published to MCP Registry" && git push
```
