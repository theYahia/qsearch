# Awesome MCP Servers — PR draft (ready to paste)

> Target list: **`punkpeye/awesome-mcp-servers`** (the canonical, most-starred awesome-mcp-servers list).
> Repo to add: **https://github.com/theYahia/qsearch** · License Apache-2.0 · Demo qsearch.pro
> Status: DRAFT — do not submit until you press the button. All facts below are read from the qsearch repo (`README.md`, `docs/TRUST_MESH.md`, `package.json`) and from the live `punkpeye/awesome-mcp-servers` `CONTRIBUTING.md` + README (fetched 2026-06-24).

---

## 1. List-entry line (paste verbatim)

```markdown
- [theYahia/qsearch](https://github.com/theYahia/qsearch) 📇 🏠 🍎 🪟 🐧 - Open-source search layer for AI agents: fetches full page content (not 200-char snippets) with multi-engine provenance (`engines[]` per URL via Brave + SearXNG) and a local trust corpus that ranks URLs by how many engines and sweeps agreed. BYOK, self-hostable.
```

**Emoji legend used (matches `punkpeye/awesome-mcp-servers` README key):**

| Emoji | Meaning | Why it applies to qsearch |
|---|---|---|
| 📇 | TypeScript / **JavaScript** codebase | `package.json` → `"type":"module"`, `main: src/server.js`; 55 `.js` source files, Node ≥20. (The list uses 📇 for both TS and JS.) |
| 🏠 | Local Service | Self-hosted, BYOK; runs on your machine (`docker compose up` + `npm start`). No mandatory cloud. |
| 🍎 🪟 🐧 | macOS / Windows / Linux | MCP server (`npm run start:mcp`, binds `127.0.0.1:8081` by default — see `src/mcp-http.js`) is pure Node, runs on all three. **Caveat (disclosed honestly):** vector corpus (Qdrant) needs bare-runtime and is currently not available on Windows — full-text Meilisearch corpus works on every OS. This is a corpus-feature caveat, not an MCP-server caveat, so all three OS emojis are correct for the server itself. (Source: README "Honest trade-offs".) |

> If you prefer a tighter one-liner (some maintainers favor a single sentence), use this shorter variant instead — same emojis:
>
> ```markdown
> - [theYahia/qsearch](https://github.com/theYahia/qsearch) 📇 🏠 🍎 🪟 🐧 - Search layer for AI agents with multi-engine provenance (`engines[]` per URL) and a local trust corpus — full page content over snippets. BYOK, self-hostable.
> ```

---

## 2. Section to add it under

**`🔎 Search & Data Extraction`** (anchor `#search` in `punkpeye/awesome-mcp-servers` README).

- This is the correct category: qsearch is a search/retrieval MCP server (web search + content extraction + corpus), not a browser-automation or scraping-only tool.
- There is no separate "Web" or "Retrieval" top-level section in this list — search, web search, and retrieval all live under **Search & Data Extraction**. (Verified against the live README section list.)
- **Alphabetical placement:** within the section, entries are sorted by the `owner/repo` string. Insert `theYahia/qsearch` in its correct alphabetical slot (owner `theYahia` → among the `t…` entries). **[GAP — verify at PR time]** I could not read the exact neighboring `t…` entries (README is long and got truncated on fetch); when editing, scan the section and drop the line between the existing alphabetical neighbors. Do not append to the bottom of the section.

---

## 3. PR title + body

### PR title

```
Add theYahia/qsearch to Search & Data Extraction
```

### PR body

```markdown
## Add: qsearch — search layer for AI agents with multi-engine provenance

**Repo:** https://github.com/theYahia/qsearch
**License:** Apache-2.0
**Live demo:** https://qsearch.pro
**Category:** 🔎 Search & Data Extraction
**Language / scope:** 📇 JavaScript (Node ≥20) · 🏠 Local / self-hosted (BYOK)

### What it is

qsearch is an open-source MCP server that gives agents **full page content with
multi-engine provenance**, instead of the 200-char snippets that most search APIs
return. Each result carries an `engines[]` field — which of {Brave, DuckDuckGo,
Google, Qwant, Startpage} actually surfaced the URL (via SearXNG aggregation) — and
a local trust corpus accumulates a per-URL trust score across sweeps
(`sweep_count`, `engine_diversity`, `topic_diversity`).

### Why it's useful to the MCP ecosystem

- **A search primitive that other MCP search servers don't expose:** `engines[]`
  per URL — a built-in consensus / trust signal. A URL found by 4 independent
  engines is real; one found by 1 is possible SEO trash. This is data the agent
  can filter on, not a bolted-on ranking.
- **Full content over snippets**, addressing the snippet-driven hallucination that
  retrieval-augmented agents hit in production.
- **Local-first + BYOK:** runs on your machine via `docker compose up` + `npm start`;
  Brave key + SearXNG + Ollama all stay local. No data exfiltration, no vendor lock-in.
- **Already MCP-native:** Streamable HTTP transport on `:8081`, works with Claude Code,
  Claude Desktop (HTTP mode), and any spec-compliant MCP client. Also published to the
  official MCP Registry as `io.github.theYahia/qsearch`.

### MCP tools exposed

`web_search`, `sweep` (batch multi-engine research sweep), `academic_search`
(arxiv + PubMed + Semantic Scholar), `sweep_context` (local LLM page extraction),
`context_search` (deep full-page content), `news_search`, `index_research`
(index local `.md` research), `economy_report` (cost vs all-Brave baseline), and
`verify_citation` (LLM-as-judge: does the cited URL actually support the claim —
Supported / Partial / Unsupported / Fabricated). Nine tools total, all registered
in `src/mcp.js`.

### Checklist

- [x] Added under the correct category (🔎 Search & Data Extraction)
- [x] Entry placed in alphabetical order within the section
- [x] Name links to the repository
- [x] Concise one-line description of functionality and key features
- [x] One server per line, follows existing README format
- [x] Open-source (Apache-2.0), public repo, working README + quick start

Thanks for maintaining this list!
```

---

## 4. CONTRIBUTING checklist (verify before opening PR)

Read from `punkpeye/awesome-mcp-servers` `CONTRIBUTING.md` (fetched 2026-06-24):

- [ ] **Name links to the repository** — `[theYahia/qsearch](https://github.com/theYahia/qsearch)` ✅ (in the line above).
- [ ] **Brief, informative description** — explains functionality + key features (multi-engine provenance, full content, trust corpus). ✅
- [ ] **Correct category** — placed under `🔎 Search & Data Extraction`. ✅
- [ ] **One server per line.** ✅
- [ ] **Alphabetical order within the category** — insert at the correct `t…` slot, NOT at the bottom. ⚠️ verify neighbors when editing (see §2 [GAP]).
- [ ] **Follow existing README format/style** — emoji legend (📇 lang, 🏠 scope, OS flags) matches the list's key. ✅
- [ ] **Accurate / up-to-date info** — repo live, README current, demo at qsearch.pro responds. ✅ (re-confirm both are reachable right before submitting.)
- [ ] (If list requires it) **one entry per PR** — this PR adds a single server.

> Note: `punkpeye/awesome-mcp-servers` `CONTRIBUTING.md` does **not** publish a strict
> minimum-age rule (unlike awesome-selfhosted's 4-month gate). No age block here.

---

## 5. Exact user click sequence

1. Open **https://github.com/punkpeye/awesome-mcp-servers** → click **Fork** (top-right) to fork the repo to your account.
2. In your fork, open **`README.md`** → click the pencil (**Edit this file**) → find the **`🔎 Search & Data Extraction`** section → paste the §1 entry line at its correct **alphabetical** position among the `t…` entries.
3. **Commit** the change to a new branch in your fork, then click **Compare & pull request** → set the **PR title** (§3) and paste the **PR body** (§3) → **Create pull request** against `punkpeye/awesome-mcp-servers:main`.

> Sequence: **fork → add the line (alphabetically in 🔎 Search & Data Extraction) → open PR.**

---

## Source provenance (no fabrication)

- One-line description, transport `:8081`, BYOK, Apache-2.0, Windows vector caveat → `README.md` + `docs/TRUST_MESH.md`.
- MCP tool list (9 tools incl. `verify_citation`) + default bind `127.0.0.1:8081` → `src/mcp.js` (`server.registerTool(...)`) + `src/mcp-http.js` (`const HOST = ... || '127.0.0.1'`). Note: README's "Available tools" list omits `verify_citation`; the code is the source of truth, so it is included here.
- Language = JavaScript / Node ≥20 → `package.json` (`type: module`, `main: src/server.js`) + 55 `.js` files in `src/`.
- Repo URL `https://github.com/theYahia/qsearch`, MCP Registry id `io.github.theYahia/qsearch` → README badges + `docs/launch-calendar.md`.
- Awesome-list entry format, emoji legend, section name `🔎 Search & Data Extraction`, alphabetical rule → live `punkpeye/awesome-mcp-servers` `CONTRIBUTING.md` + README, fetched 2026-06-24.
- **[GAP]** exact alphabetical neighbor entries in the Search section (README truncated on fetch) — verify visually when editing the file.
