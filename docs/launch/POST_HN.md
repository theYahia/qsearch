# Show HN — qsearch (canonical post)

> Publish-ready Show HN draft for the v0.4.0 launch. Angle: **multi-engine `engines[]` attribution + live citation verification (`/verify`)** — the two halves of "is this source real, and does it actually back the claim?"
>
> Consolidates and supersedes `SHOW_HN.md`, which led on `engines[]` only and never mentioned `/verify`. Keep one canonical Show HN; if you post, post this. Numbers are read from README.md / `src/` only; anything unverifiable is marked [GAP].

---

## Title (HN cap: 80 chars)

```
Show HN: qsearch – self-hosted search for AI agents that verifies citations
```

(74 chars. URL field on the submit form → `https://github.com/theYahia/qsearch`, repo first, not the homepage.)

Backup titles if the main one stalls:
1. `Show HN: qsearch – agent search that shows which engines agreed on a result`
2. `Show HN: qsearch – self-hosted agent search with per-URL engine provenance`

---

## Body (~210 words)

```
I run a lot of agent research sprints, and my agents kept stating things
their sources never actually said. Two root causes, both in the search
layer: the APIs I gave them (Tavily, Exa, Serper) return ranked 200-char
snippets, and the ranking hides the one signal I want — which underlying
engines agreed a URL even exists.

So I built qsearch. It fans a query out to Brave (BYOK) plus a self-hosted
SearXNG, and SearXNG aggregates Google, DuckDuckGo, Brave, Qwant, Startpage.
qsearch keeps the per-result `engines[]` field instead of throwing it away:
a URL found by 4 engines reads very differently from one found by Google
alone. You can filter `engine_count >= 3` for the high-trust subset.

The second half is `POST /verify`: give it a (claim, url) pair and it
fetches the page and runs an LLM-as-judge at temperature 0 to return
Supported / Partial / Unsupported / Fabricated, plus the verbatim quote it
relied on. "Fabricated" means the cited URL is genuinely dead — the cite
points nowhere. The same verifier backs my citation-honesty benchmark.

Every result lands in a local corpus (Meilisearch + Qdrant); across sprints
each URL grows a trust score. Speaks MCP over HTTP, so Claude Code calls it
directly. Node + Docker, BYOK, Apache-2.0. Demo: https://qsearch.pro
```

(~205 words.)

---

## First comment (post within 60s of submitting)

```
Author here — more detail, since "trust" and "verify" both get overloaded.

Two separate signals, deliberately:

1) engines[] is provenance, not a verdict. It only tells you how many
independent engines surfaced a URL. The trust score on top is emergent,
not a model I tuned:

    trust(url) = log(sweep_count + 1) × engine_diversity × topic_diversity

log() dampens a few high-frequency URLs; the diversity terms stay linear
because gaming Google + DDG + Brave + Qwant at once is much harder than
gaming one.

2) /verify is the claim-level check. (claim, url) → fetch the page (PDF via
pdfjs, HTML SSRF-guarded, JS-shell/403 via headless Crawl4AI, dead → Fabricated)
→ rank the most relevant passages → LLM-as-judge at temp 0 (local
qwen2.5:14b via Ollama, or DeepSeek if a key is set) → verdict + the verbatim
supporting quote. Verdicts are cached by (version|judge|url|claim) so a
re-run is byte-identical. The same verifier runs my citation-honesty
benchmark; measured judge↔human agreement there is κ=0.75 (87.3%) [from the
repo — your mileage will vary by domain].

Stack: Node ≥20, Brave API (BYOK), self-hosted SearXNG, Meilisearch +
Qdrant, optional Crawl4AI, optional Ollama (search still works without the
local models). MCP-over-HTTP on :8081 exposes web_search / sweep /
academic_search (arxiv + PubMed + Semantic Scholar, no auth) / sweep_context
/ verify_citation. Apache-2.0, self-hostable, no data exfiltration.

Honest limits, since HN will ask:
- Cold start ~5-10s on the first sweep; best run as a long-lived daemon.
- Qdrant vector corpus needs bare-runtime — Windows is full-text-only
  (Meilisearch works everywhere).
- engines[] needs SearXNG; pure-Brave mode works but loses that signal.
- Federation across users is a research direction, NOT shipped. v0.4.0 is
  local-only and that's the honest scope today.

What I'd love feedback on: the trust formula, and whether the judge's
Supported/Partial/Unsupported/Fabricated split holds up on your sources.

Repo: https://github.com/theYahia/qsearch
Spec: docs/TRUST_MESH.md · verifier: src/verifier/README.md
```

---

## Submit checklist (evergreen — no fixed date)

- [ ] Post from an aged account with real karma (see POSTING_PLAN.md pre-reqs), not a fresh one.
- [ ] `git clone` → `docker compose up -d` → `npm install && npm start` clean on a fresh checkout right before posting.
- [ ] `qsearch.pro` returns 200 at submit time (`curl -sI https://qsearch.pro`).
- [ ] Ollama `qwen2.5:14b-instruct` (or `DEEPSEEK_API_KEY`) running, so a live `/verify` demo returns a real verdict, not `Error`. Run the copy-paste **Smoke-test block** in `POSTING_PLAN.md` (HN pre-reqs) to confirm all four checks at once.
- [ ] Submit with the **repo URL**, not the homepage.
- [ ] Paste the first comment immediately after submitting — don't wait.
- [ ] Reply to every comment within ~10 min for the first 2 hours. Technical, no marketing.
- [ ] Best window: a US-morning weekday slot (see POSTING_PLAN.md). Never ask for upvotes anywhere.

---

## Claim provenance (anti-fabrication)

- `engines[]` / `engine_count` / `engine_count >= 3` filter, trust formula `log(sweep_count+1) × engine_diversity × topic_diversity` — README.md + docs/TRUST_MESH.md.
- `/verify` body `{claim, url}`, verdicts `Supported`/`Partial`/`Unsupported`/`Fabricated`/`Error`, verbatim excerpt, never-throws → `src/server.js` `handleVerify` + `src/verifier/README.md`.
- Judge = LLM-as-judge temp 0, local `qwen2.5:14b-instruct` (Ollama) or DeepSeek when key set; cache key `(CACHE_VERSION|judge|url|claim)` — `src/verifier/README.md`.
- κ=0.75 / 87.3% = doesitlie benchmark gold-agreement — `src/verifier/README.md` (domain-dependent; flagged as repo figure in the comment).
- Fetch path PDF→pdfjs / HTML SSRF-guarded / Crawl4AI headless / dead→Fabricated — `src/verifier/README.md`.
- MCP tools + `:8081` transport, Stack, cold-start / Windows / SearXNG / federation limits — README.md.
- The README's 17–33% hallucination figure is intentionally NOT in the body (kept agent-experience-led, not stat-led); available as cited external research if a commenter pushes for it.
