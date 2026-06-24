# Show HN — qsearch (Trust Mesh)

> Fresh draft for the v0.4.0 launch. Built around the current positioning: multi-engine `engines[]` provenance + persistent local corpus + MCP-native trust layer for AI agents. Supersedes `docs/legacy/HN_POST_DRAFT.md` (which pitched the old QVAC-SDK framing — do not reuse).
>
> Numbers below are taken from README.md / code only. Anything I couldn't verify is marked [GAP].

---

## Title (80 chars max)

```
Show HN: qsearch – self-hosted search layer for AI agents with provenance
```

(73 chars, comfortably under HN's 80-char cap. URL field on submit form: https://github.com/theYahia/qsearch)

Backup titles if the main one underperforms:
1. `Show HN: qsearch – search for AI agents that tells you which engines agreed`
2. `Show HN: qsearch – open-source search layer with per-URL engine provenance`

---

## Body (~200 words)

```
I run a lot of agent research sprints, and my agents kept making things up
because the search APIs I gave them (Tavily, Exa, Serper) only return ranked
snippets. Two things bother me: snippets aren't enough to ground an answer,
and the ranking hides the one signal I actually want — which underlying
engines agreed this URL exists.

So I built qsearch. It fans a query out to Brave (BYOK) plus a self-hosted
SearXNG, and SearXNG itself aggregates Google, DuckDuckGo, Brave, Qwant,
Startpage. qsearch keeps the per-result `engines[]` field instead of throwing
it away: a URL found by 4 engines reads very differently from one found by
Google alone.

Every result lands in a local corpus (Meilisearch + Qdrant). Across sprints
each URL grows `sweep_count`, engine diversity and topic diversity, and a
trust score emerges from that — no human ranking, no cloud round-trip. You
can filter `engine_count >= 3` for the high-trust subset, or hit
`/corpus/top` and `/trust/:url`.

It speaks MCP over HTTP, so Claude Code (or any spec-compliant client) gets
web/academic/sweep tools directly. Node.js + Docker, BYOK, Apache-2.0.
Live demo: https://qsearch.pro
```

(~183 words — deliberately terse for HN; under the ~200 target rather than padded)

---

## First comment (what's under the hood)

```
Author here — a bit more detail on how it actually works, since "trust" gets
overloaded.

The trust signal isn't a model or a heuristic I tuned. It's emergent from
agreement over time:

    trust(url) = log(sweep_count + 1) × engine_diversity × topic_diversity

sweep_count = distinct research sprints that surfaced the URL; engine_diversity
= distinct engines (via SearXNG aggregation) that ever returned it;
topic_diversity = distinct topics it showed up under. log() dampens a few
high-frequency URLs; the diversity terms are linear because gaming Google +
DDG + Brave + Qwant simultaneously is much harder than gaming one.

Stack: Node.js ≥20, Brave Search API (BYOK), self-hosted SearXNG for the
multi-engine aggregation, Meilisearch (full-text corpus) + Qdrant (vector),
optional Crawl4AI for full-page fetch, optional Ollama (qwen2.5 cleaner +
nomic-embed-text rerank — search still works without them). MCP-over-HTTP on
:8081 exposes web_search / sweep / academic_search (arxiv + PubMed + Semantic
Scholar, no auth) / sweep_context (local LLM extraction). Apache-2.0, BYOK,
self-hostable, no data exfiltration.

Honest limits, since HN will ask:
- Cold start ~5-10s on the first sweep (engine fan-out + indexing); best run
  as a long-lived daemon.
- Vector corpus (Qdrant) needs bare-runtime — Windows is full-text-only.
  Meilisearch works everywhere.
- engines[] needs SearXNG. Pure-Brave mode works but loses the multi-engine
  signal.
- Federation across users is a research direction, not shipped — I'm not
  pitching a "decentralized validator network." v0.4.0 is local-only and
  that's the honest scope today.

What I'd love feedback on: the trust formula itself, and whether the
engine-agreement signal holds up against adversarial SEO in your experience.

Repo: https://github.com/theYahia/qsearch
Technical spec: docs/TRUST_MESH.md in the repo
```

---

## Submit checklist

- [ ] Submit from an account with some karma (not brand new)
- [ ] `npm install && npm start` clean on a fresh clone before posting
- [ ] qsearch.pro demo reachable at submit time
- [ ] Post the first comment immediately after submitting (don't wait)
- [ ] Time: weekday US morning Pacific [GAP — confirm exact slot vs launch-thread.md guidance]

---

## Notes on provenance of claims (anti-fabrication)

- v0.4.0, `engines[]` / `sweep_count` / `trust_score`, `/trust/:url`, `/corpus/top`, `engine_count >= 3` filter — README.md.
- Trust formula `log(sweep_count + 1) × engine_diversity × topic_diversity` — README.md + docs/TRUST_MESH.md.
- Stack (Node ≥20, SearXNG, Meilisearch, Qdrant, Crawl4AI, Ollama qwen2.5 + nomic-embed-text, MCP `@modelcontextprotocol/sdk`) — README.md "Stack" table.
- MCP tools (web_search / sweep / academic_search / sweep_context) + `:8081` HTTP transport — README.md "MCP integration".
- academic_search = arxiv + PubMed + Semantic Scholar, no auth — README.md.
- Windows = full-text only (Qdrant bare-runtime), cold start 5-10s, engines[] needs SearXNG — README.md "Honest trade-offs".
- Federation = research-direction / not shipped — README.md roadmap (v0.7+) + docs/VISION.md.
- Apache-2.0, BYOK, qsearch.pro — README.md.
- The 17-33% hallucination / +7.3pp figures from the README were intentionally LEFT OUT of the post body to keep it agent-experience-led rather than stat-led; they remain available as cited external research if a commenter pushes for evidence.
