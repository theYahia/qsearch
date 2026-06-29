# Reddit post — r/LocalLLaMA / r/LocalLLM

> Publish-ready draft. Community tone: self-hosted, BYOK, $0 lower tiers, local model judge. No marketing voice, no upvote asks, disclose solo-dev. Facts read from `README.md` / `src/` only; repo figures flagged inline.
>
> r/LocalLLaMA leans research-y; r/LocalLLM leans run-it-at-home. Same body works for both. Check each sub's rules for a self-promo / "Project" flair before posting; some require it. Disclose it's your own project in the first line (r/LocalLLaMA has banned posts where "solo dev" turned out to be a company product — be upfront).

---

## Title options

1. `I built a self-hosted search layer for agents — runs the citation-checker on a local qwen2.5, $0 on the SearXNG tier`
2. `Self-hosted agent search with multi-engine provenance + a local-LLM citation verifier (BYOK, Apache-2.0)`
3. `Tired of my agent citing pages that don't say what it claims — built a local /verify endpoint (Ollama judge)`

(Pick one. #1 leads with the local-model angle this sub cares about.)

---

## Body

```
Disclosure up front: this is my own project, solo dev, Apache-2.0. Sharing
because the design choices are squarely a local-LLM thing and I want this
sub to tear them apart.

The problem I kept hitting: agents reading 200-char search snippets state
things their cited source never actually says — sometimes the page is just
adjacent, sometimes it's a dead 404. Hosted search APIs (Tavily/Exa/Serper)
are stateless, closed, and throw away the one signal I want: which engines
actually agreed a URL exists.

So I built qsearch — a self-hosted search layer that runs on your machine.
Two parts that matter here:

1) Multi-engine provenance. It fans out to a self-hosted SearXNG (Google,
DDG, Brave, Qwant, Startpage) and keeps the per-URL `engines[]` field +
`engine_count`. A URL 4 engines returned is different from one 1 engine did.
You can filter `engine_count >= 3` for the high-trust subset. A trust score
grows across sweeps: log(sweep_count+1) × engine_diversity × topic_diversity.

2) A citation verifier that runs on YOUR model. POST /verify takes
{claim, url}, fetches the page (PDF→pdfjs, HTML SSRF-guarded, JS/403→headless
Crawl4AI, dead→Fabricated), ranks the relevant passages, then runs an
LLM-as-judge at temp 0 — local qwen2.5:14b-instruct via Ollama by default
(DeepSeek only if you set a key). Returns Supported / Partial / Unsupported
/ Fabricated + the verbatim quote it relied on. Verdicts are cached by
(version|judge|url|claim) so re-runs are byte-identical. No cloud round-trip
for the judge unless you opt in.

What's actually local / free:
- SearXNG `broad` tier = $0, no API key. The 5-minute path needs no key.
- Cleaner = Ollama qwen2.5:7b-instruct. Embedding rerank = nomic-embed-text.
  Judge = qwen2.5:14b-instruct. All local. Search still works without them.
- Brave key is optional, only for the focused/critical tiers (~$0.005-0.01/q).
- Corpus is Meilisearch (+ Qdrant for vectors where the runtime supports it),
  on your disk.

MCP-over-HTTP on :8081, so Claude Code / any spec client calls web_search /
sweep / academic_search (arxiv+PubMed+Semantic Scholar, no auth) /
sweep_context / verify_citation directly.

Honest limits: cold start ~5-10s (run it as a daemon); Qdrant vectors need
bare-runtime so Windows is full-text-only (Meilisearch works everywhere);
engines[] needs SearXNG; federation across users is a research direction,
NOT shipped — v0.4.0 is local-only.

5-min start (no key):
  git clone https://github.com/theYahia/qsearch.git && cd qsearch
  cp .env.example .env.local
  docker compose up -d        # Meilisearch + Qdrant + SearXNG
  npm install && npm start    # :8080
  ollama pull qwen2.5:14b-instruct   # for local /verify

Repo: https://github.com/theYahia/qsearch (Apache-2.0)

Two things I'd genuinely like criticism on:
- The trust formula — does engine/topic diversity hold up against adversarial
  SEO in your experience?
- The judge split — does Supported/Partial/Unsupported/Fabricated survive on
  your sources? On my citation-honesty benchmark the judge↔human agreement is
  κ=0.75 / 87.3% binary, but that's domain-dependent and I'd expect it to
  move on yours.
```

---

## Comment-reply notes (have these ready)

- **"Which exact model for the judge?"** Default `qwen2.5:14b-instruct` on Ollama, temp 0; configurable via `DOESITLIE_JUDGE_MODEL`. DeepSeek path only fires if `DEEPSEEK_API_KEY` is set — otherwise fully local.
- **"VRAM?"** [GAP — not asserted in repo; say what you actually run it on rather than guessing. Do not fabricate a VRAM number.]
- **"Why not embeddings-only / why an LLM judge?"** Passage ranking is lexical + exact-anchor (statute numbers, dollar amounts, quoted phrases); the LLM-as-judge is the verdict step. Both run locally.
- **"Does it phone home?"** No. Brave key + SearXNG + Ollama all stay on your machine; the judge is local unless you opt into DeepSeek.
- **"Federation / decentralized validator network?"** Not shipped. Research direction only. v0.4.0 is local-only — say so plainly.

---

## Provenance (anti-fabrication)

- Local judge `qwen2.5:14b-instruct` temp 0 / DeepSeek opt-in / cache key — `src/verifier/README.md`.
- Verdicts `Supported`/`Partial`/`Unsupported`/`Fabricated`/`Error` + verbatim excerpt; fetch path PDF/HTML/Crawl4AI/dead→Fabricated — `src/verifier/README.md` + `src/server.js`.
- Models: cleaner `qwen2.5:7b-instruct`, embed `nomic-embed-text`, sweep tiers `broad`/`focused`/`critical` $0 / ~$0.005 / ~$0.01 — README.md.
- `engines[]`, `engine_count >= 3`, trust formula — README.md + docs/TRUST_MESH.md.
- κ=0.75 / 87.3% = doesitlie benchmark figure, domain-dependent — `src/verifier/README.md` (flagged in body).
- Cold start / Windows / SearXNG / federation-not-shipped — README.md.
