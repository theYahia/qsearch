---
title: "Why your AI agent cites sources that don't say what it claims — and a self-hosted fix"
description: "Agents hallucinate because they read snippets, not pages — and nothing checks whether a cited URL actually backs the claim. Here is how I added multi-engine provenance and a citation-verification endpoint to a self-hosted search layer."
slug: ai-agent-citation-verification-self-hosted-search
canonical_url: ""
tags: [ai, opensource, llm, search]
cover_image: ""
license: Apache-2.0
status: draft
---

> Build-in-public draft for dev.to. Every number and behavior below is read from the qsearch repo (`README.md`, `src/`). Things I have not independently re-measured are flagged inline. dev.to allows 4 tags — `#ai #opensource #llm #search`; swap `#search` for `#mcp` if you want the MCP crowd instead.
>
> `canonical_url` is left empty so dev.to is the canonical home of this article. The front-matter key is `canonical_url` (not `canonical`). **Only** fill it if you publish the same body somewhere else first (your own blog, qsearch.pro) and want dev.to to point Google at that primary copy — point it at the rendered article URL, never at a raw GitHub `.md` blob.

## The bug isn't in your prompt. It's in your search layer.

I run a lot of agent research sprints. After enough of them, a pattern got hard to ignore: the agent would write a confident sentence, cite a URL, and the URL wouldn't actually say that. Sometimes the page said something *adjacent*. Sometimes the page was a 404.

I spent a while blaming the model. Wrong place to look. The model was doing its best with what the search tool handed it, and the search tool handed it two bad things:

1. **200-character snippets** instead of page content. There isn't enough text in a snippet to ground a claim, so the model fills the gap.
2. **A ranked list with no provenance.** Position 3 (SEO spam) looks identical to position 4 (the authoritative source). Nothing tells the agent *which engines actually agreed this URL exists*.

Hosted search APIs (Tavily, Exa, Serper) are convenient, but they're stateless, closed, and they throw away the one signal I wanted. So I built [qsearch](https://github.com/theYahia/qsearch) — a self-hosted search layer for agents. Apache-2.0, runs on your machine, bring-your-own-key. This post is about the two parts that fix the two failures above.

## Part 1: keep the `engines[]`, don't throw it away

qsearch fans a query out to Brave (your key) plus a self-hosted [SearXNG](https://github.com/searxng/searxng). SearXNG already aggregates Google, DuckDuckGo, Brave, Qwant, Startpage — and it *knows* which of them returned each URL. Most tools discard that. qsearch keeps it as a per-result `engines[]` field with a denormalized `engine_count`.

```bash
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'t1|self-hosted search engine 2026\n'
```

Output excerpt (`parsed_snippets.md`):

```markdown
**1. GitHub - searxng/searxng**
- URL: https://github.com/searxng/searxng
- Engines: google, duckduckgo, brave, qwant (count=4)

**2. random-blog.io/seo-spam-2026**
- URL: https://random-blog.io/seo-spam-2026
- Engines: google (count=1)
```

A URL four independent engines agreed on is a different kind of result than one a single engine surfaced. That's a trust signal sitting in the data, not a ranking opinion bolted on top. Every sweep auto-indexes into a local Meilisearch corpus, so you can filter for the high-trust subset directly:

```bash
curl -H "Authorization: Bearer masterKey" \
  "http://localhost:7700/indexes/qsearch_corpus/documents?filter=engine_count%20%3E%3D%203"
```

Across many sprints, each URL also grows a trust score. The formula, straight from the spec:

```
trust(url) = log(sweep_count + 1) × engine_diversity × topic_diversity
```

`log()` dampens a handful of high-frequency URLs; the diversity terms stay linear because faking agreement across genuinely independent engines and topics is much harder than spamming one. Authority emerges from your own usage instead of a vendor's opaque ranker.

## Part 2: a verdict on whether the source backs the claim

Provenance answers "is this URL real and corroborated?" It does *not* answer "does this page actually support the sentence my agent wrote?" That's a separate, claim-level question — so it gets a separate endpoint, `POST /verify`:

```bash
curl -X POST http://localhost:8080/verify \
  -H "Content-Type: application/json" \
  -d '{"claim":"Qdrant is written in Rust.","url":"https://github.com/qdrant/qdrant"}'
```

```json
{
  "claim": "Qdrant is written in Rust.",
  "source_url": "https://github.com/qdrant/qdrant",
  "verdict": "Supported",
  "excerpt": "...the most relevant verbatim passage the judge relied on...",
  "confidence": 0.0   // judge self-rating in [0,1] — illustrative, not a fixed value
}
```

What happens under the hood:

1. **Fetch readable text** — PDF via pdfjs, HTML via an SSRF-guarded fetch, JS-shell / 403 pages via headless Crawl4AI. If the URL is genuinely dead (404/410/dead domain), the verdict short-circuits to `Fabricated` — the cite points nowhere.
2. **Rank passages** — lexical overlap plus an exact-anchor boost for statute numbers, dollar amounts, and quoted phrases, so the judge reads the passages most likely to settle the claim first.
3. **LLM-as-judge at temperature 0** — local `qwen2.5:14b-instruct` via Ollama by default, or DeepSeek if `DEEPSEEK_API_KEY` is set. It returns one of:

| Verdict | Meaning |
|---|---|
| `Supported` | the page states the claim's core assertion |
| `Partial` | related and partly backs it, but the claim overstates / drifts / adds an absent specific |
| `Unsupported` | core assertion absent, off-topic, or contradicted |
| `Fabricated` | the cited URL is gone — the cite points nowhere |
| `Error` | couldn't fetch/parse (PDF fail, bot-block, timeout) — counted in coverage, not hidden |

Verdicts are cached by `(CACHE_VERSION | judge | url | claim)`, so a re-run returns byte-identical results — useful when you wire `/verify` into a test or a CI gate. The same verifier powers a citation-honesty benchmark in the repo; its measured judge↔human agreement there is κ=0.75 (87.3% binary). That number is domain-dependent — treat it as a starting point, not a guarantee for your sources.

## Wiring it into an agent (MCP)

qsearch speaks MCP over HTTP on `:8081`, so Claude Code or any spec-compliant client gets the tools directly. Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "qsearch": {
      "type": "http",
      "url": "http://localhost:8081"
    }
  }
}
```

Tools exposed include `web_search`, `sweep` (batch multi-engine research), `academic_search` (arxiv + PubMed + Semantic Scholar, no auth), `sweep_context` (local LLM page extraction), and `verify_citation` — the `/verify` logic above, callable by the agent itself. An agent that can check its own citations before it writes them is a meaningfully different agent.

## Run it in five minutes (free tier, no API key)

```bash
git clone https://github.com/theYahia/qsearch.git && cd qsearch
cp .env.example .env.local       # works as-is on the $0 SearXNG tier
docker compose up -d             # Meilisearch + Qdrant + SearXNG
npm install && npm start         # → http://localhost:8080
```

The `broad` sweep tier runs on self-hosted SearXNG and costs nothing. Add a Brave key only for the `focused` (~$0.005/query) and `critical` (~$0.01/query) tiers. For local `/verify`, pull the judge model: `ollama pull qwen2.5:14b-instruct`.

## Honest trade-offs

I'd rather you know these before you `git clone`:

- **Cold start.** First sweep is ~5–10s (engine fan-out + indexing). Best run as a long-lived daemon.
- **Windows = full-text only.** The Qdrant vector corpus needs a bare runtime; Meilisearch full-text works everywhere.
- **`engines[]` needs SearXNG.** Pure-Brave mode works but loses the multi-engine signal.
- **Extraction quality isn't the pitch.** The local cleaner is a small Ollama model. The wedge is ownership, provenance, and verifiability — not out-cleaning a datacenter GPU.
- **Federation across users is a research direction, not shipped.** v0.4.0 is local-only, and that's the honest scope today.

## Try it / tear it apart

Repo: [github.com/theYahia/qsearch](https://github.com/theYahia/qsearch) · Live demo: [qsearch.pro](https://qsearch.pro) · Verifier internals: [`src/verifier/README.md`](https://github.com/theYahia/qsearch/blob/main/src/verifier/README.md)

The two design choices I'd most like criticism on: the trust formula, and whether the judge's Supported/Partial/Unsupported/Fabricated split survives contact with your own sources. If you catch a wrong fact, open an issue — corrections land in the repo first.
