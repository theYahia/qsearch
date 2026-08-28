# README first-visit polish — what changed and why

> Edits applied to `README.md` for first-visit conversion (clearer hero → value → CTA). **No existing factual number or claim was changed, and no link was removed.** All additions are read straight from the repo (`src/`), so nothing here is fabricated.

## Goal

A first-time visitor should, above the fold and in the first screen of Quick start, understand (1) what qsearch is, (2) what they get, and (3) how to run it in one short copy-paste — without scrolling past an 8-step setup wall or missing the citation-verification angle the launch leads on.

## Changes

### 1. "Run it in 5 minutes" fast path at the top of Quick start
**Why:** the previous Quick start opened with an 8-step block (Brave key, Ollama pulls, MCP). That's the full path, not the first-visit path — it reads as heavy and buries the fact that the free SearXNG tier needs no API key. Conversion drops when the first action looks expensive.
**What:** added a 4-line clone→`.env`→`docker compose`→`npm start` block plus the one-call `/sweep` curl at the very top, with a sentence stating the `broad` tier is $0 and Brave is optional. The original full 8-step sequence is preserved verbatim inside a collapsed `<details><summary>Full setup</summary>` block right below it.
**Claim safety:** the fast path is a strict subset of the existing steps; the "$0 SearXNG tier / Brave optional" framing restates the existing `broad`/`focused`/`critical` tier pricing already in the API section. No new numbers.

### 2. Surfaced `POST /verify` in the API table
**Why:** the launch angle is "multi-engine attribution **+** citation verification," and `/verify` is the second half — but it was only mentioned in the demo caption, absent from the API table. First-visit readers who scan the table never saw it.
**What:** added one row: `POST /verify` → citation honesty check, verdicts `Supported`/`Partial`/`Unsupported`/`Fabricated`/`Error` + verbatim excerpt, backend = LLM-as-judge (local Ollama qwen2.5 or DeepSeek).
**Claim safety:** verified against `src/server.js` (`handleVerify`, route `POST /verify`) and `src/verifier/README.md` (verdict set, judge model, behavior). This documents an existing shipped endpoint — not a new promise.

### 3. Added `verify_citation` to the MCP tools list
**Why:** same omission on the MCP side — the tool ships in `src/mcp.js` but the README's "Available tools" list skipped it (noted previously in `awesome-mcp-PR.md`). An agent-builder scanning the MCP section couldn't tell the verifier was callable.
**What:** added one bullet: `mcp__qsearch__verify_citation` with the verdict set.
**Claim safety:** verified against `src/mcp.js` (`registerTool('verify_citation', …)` → `/verify`).

## Deliberately NOT changed

- The hero blockquote, the 17–33% / +7.3pp stats, the comparison table, the trust formula, the roadmap, and all "Honest trade-offs" — left exactly as written. They are the maintained source of truth.
- Every existing link preserved (Stanford PDF, arxiv refs, ARCHITECTURE/VISION/TRUST_MESH, badges, qsearch.pro, repo, X).
- No badge changes, no version-string changes.

## Net effect

First screen now answers "what / what-I-get / run-it" without scrolling, and the citation-verification half of the pitch is visible in the two places people actually scan (API table + MCP tools) instead of only in the demo caption. Zero claims altered.
