---
title: "qsearch vs Tavily, Exa, Perplexity, SearXNG, Brave — an honest comparison from the person who built qsearch"
description: "Build-in-public: where qsearch wins, where it loses, and where the hosted search APIs are still the right call. No straw men."
slug: qsearch-vs-tavily-exa-perplexity-searxng-brave
canonical: https://github.com/theYahia/qsearch/blob/main/docs/launch/comparison-post.md
tags: [ai-agents, search, mcp, open-source, rag, self-hosted]
license: Apache-2.0
status: draft
date: 2026-06-24
---

# qsearch vs Tavily, Exa, Perplexity, SearXNG, Brave — an honest comparison

I build qsearch. So treat this as a partisan document — but a partisan document that tells you where my project loses, because a comparison post that only flatters the author's tool is worthless to you and embarrassing to me.

qsearch is an open-source search layer for AI agents: full page content instead of 200-character snippets, multi-engine provenance (`engines[]` per URL), a persistent local corpus that grows a trust score over time, and an MCP server so Claude Code or any spec-compliant client can call it directly. Apache-2.0, runs on your machine, bring-your-own-key.

The honest framing up front: **for many people, a hosted search API is the right answer.** If you want the least friction and you do not care that results flow through someone else's infrastructure, the managed products win on setup time. qsearch is for a narrower case, and this post is about drawing that line precisely.

A note on what follows. I can speak in detail about qsearch because I read its code every day. I can speak about the competitors only as far as I have verified — and I have flagged every competitor claim I have *not* independently checked as `[GAP: verify]`. I would rather leave a gap than print a number I cannot stand behind. If you catch a wrong fact, open an issue and I will fix the post.

---

## The one-paragraph answer

Use qsearch when local ownership, an auditable trust signal, and a corpus that compounds across research sessions are worth a docker-compose and a daemon you keep running. Use a hosted API when you want a single HTTP call with no infrastructure and you accept that the vendor sees your queries. Most of the real difference is not snippet quality — it is *who holds the data* and *whether the search layer remembers anything*.

---

## The comparison table

This table is reproduced from the qsearch README, where it is the maintained source of truth. I have kept it to the exact cells the README asserts — I have not invented entries for products or dimensions the README does not cover.

|  | Tavily | Exa | Serper | Brave API | SearXNG | **qsearch** |
|---|---|---|---|---|---|---|
| Open source core | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Full content (not snippets) | partial | partial | ❌ | ❌ | ❌ | ✅ |
| Multi-engine attribution | ❌ | ❌ | ❌ | ❌ | partial | ✅ (`engines[]`) |
| Persistent local corpus | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Trust score per URL | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Self-hostable | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| MCP-native | partial | ✅ | ❌ | ✅ | ❌ | ✅ |
| BYOK upstream | ❌ | ❌ | ❌ | N/A | ✅ | ✅ |

Two things to call out before anyone reads this as a clean sweep:

- **Perplexity is not in this table.** The README comparison covers Tavily, Exa, Serper, Brave API, and SearXNG. I have not built a verified column for Perplexity, so I am not going to fabricate one — see the Perplexity section below for what I can and cannot say.
- **`partial` is doing real work.** "Tavily: full content — partial" is the README's honest hedge, not a dismissal. The hosted products fetch and structure content; the README marks them `partial` rather than `❌` precisely because they do more than raw snippets. I am not going to overstate that gap.

---

## Where qsearch actually differs

These are the four cells where qsearch is the only `✅` in the table. They are the reason the project exists. Everything here is verifiable in the qsearch code and docs — no competitor claims involved.

### 1. Multi-engine attribution (`engines[]` per URL)

When qsearch runs a sweep through SearXNG, SearXNG aggregates several underlying engines (Google, DuckDuckGo, Brave, Qwant, Startpage, and more). qsearch keeps the attribution instead of throwing it away. Every result carries `engines: [...]` and a denormalized `engine_count`.

```markdown
**1. GitHub - searxng/searxng**
- URL: https://github.com/searxng/searxng
- Engines: google, duckduckgo, brave, qwant (count=4)

**2. random-blog.io/seo-spam-2026**
- URL: https://random-blog.io/seo-spam-2026
- Engines: google (count=1)
```

A URL that four independent engines agreed on is a different kind of result than one a single engine surfaced. That is a trust signal sitting in the data, not a ranking opinion bolted on top. The README marks SearXNG itself as `partial` here — the signal exists inside SearXNG, but qsearch is what propagates it through the result, into the corpus, and into a Meilisearch filter you can query (`engine_count >= 3`).

### 2. Persistent local corpus

Every sweep auto-indexes into a local Meilisearch (and Qdrant for vector search, where the platform supports the bare runtime). The corpus is yours and it lives on your disk. Run ten research sprints on the same domain and `/corpus/top?min_engines=3` shows the URLs that survived multiple independent engines across multiple sessions.

No hosted API in the table offers this, because it is structurally not their product — a stateless API call cannot accumulate *your* private history. This is the single feature I personally rely on most: search that remembers.

### 3. Trust score per URL

On top of the corpus, qsearch computes a per-URL trust score. The formula from the technical spec:

```
trust(url) = log(sweep_count + 1) × engine_diversity × topic_diversity
```

The log dampens runaway frequency; engine and topic diversity are linear because they are harder to fake — you need genuinely independent agreement and genuine topical breadth. A URL that shows up across five sweeps, five engines, and four topic clusters earns a high score; a one-off SEO page earns roughly nothing. Authority emerges from your own usage rather than from a vendor's opaque ranker.

### 4. Self-hosted, BYOK, $0 SearXNG tier

qsearch runs on your machine. The SearXNG path costs nothing — no API key, no per-query charge — and still gives you the multi-engine signal. If you want Brave's independent index on top, you bring your own Brave Search API key; the README documents that as roughly $5/month for about 1000 queries. The key and the quota are yours. Nothing is exfiltrated through a middleman.

The cost routing is explicit. A sweep query can be tagged `broad` (SearXNG, $0), `focused` (Brave, about $0.005), or `critical` (Brave plus local LLM context extraction, about $0.01). You decide per query where the spend goes — most of a research sprint can sit on the free tier.

---

## Where qsearch loses — read this part

If the section above were the whole story, I would not trust this post either. Here is where the hosted products are the better choice.

**Setup cost is real.** A hosted API is one HTTP call after you paste a key. qsearch is a docker-compose (Meilisearch, Qdrant, SearXNG), an optional Ollama pull for local cleaning and rerank, and a daemon you keep alive. The README's own honest-tradeoffs section says the first sweep takes 5–10 seconds for engine fan-out and corpus indexing, and recommends running it as a long-lived daemon rather than a cold start. That is materially more operational weight than `pip install` and a key.

**Snippet/extraction quality is not the pitch.** I do not claim qsearch out-cleans a large model on a datacenter GPU. The local-LLM cleaning path uses a small Ollama model; it is good enough to be useful and it runs on your hardware, but quality is not the wedge. The wedge is ownership, provenance, and memory. If a competitor's hosted extraction is sharper on your queries, I believe you — that is a real reason to use them.

**Platform limits exist.** Per the README, vector search via Qdrant needs the bare runtime and is blocked on some platforms (Windows is called out); full-text Meilisearch works everywhere, but you lose vector rerank where Qdrant cannot run. Full-content fetching also has a latency cost, which qsearch makes opt-in rather than default.

**SearXNG self-hosting is required for the free tier.** Public SearXNG instances get rate-limited and blocked by Google; the multi-engine signal depends on running your own. The docker-compose handles it, but it is still infrastructure you own and maintain.

If those costs do not buy you anything — if you do not need local ownership, an auditable trust signal, or a compounding corpus — then a managed API is simply less work, and you should use one.

---

## On the specific competitors

I am deliberately conservative here. The README table is my verified source for Tavily, Exa, Serper, Brave API, and SearXNG. Anything beyond those cells I have marked as a gap rather than guessed.

### SearXNG

The honest sibling. SearXNG is open source and self-hostable — the same two `✅` cells qsearch has — and it is the metasearch engine qsearch builds *on top of*. The README marks it `partial` on multi-engine attribution (the signal exists internally) and `❌` on persistent corpus, trust score, full-content extraction, and MCP-native. In other words: if you want a self-hosted metasearch box and nothing more, SearXNG alone is a perfectly good answer. qsearch adds the corpus, the trust scoring, the full-content path, and the MCP server around it. Use SearXNG raw if those additions do not earn their keep for you.

### Brave API

In the README table Brave is `❌` on open-source core, full content, multi-engine attribution, persistent corpus, trust score, and self-hostable, and `✅` on MCP-native; BYOK is marked `N/A` because Brave *is* the upstream you bring a key to. That is the relationship: Brave is one of qsearch's backends, not a rival to route around. qsearch's `focused` and `critical` tiers call Brave's independent index directly with your key. If your need is "a solid independent web index behind one API key," Brave on its own covers it — qsearch is what wraps provenance, corpus, and trust around that call.

[GAP: verify Brave Search API current pricing tiers beyond the README's "~$5/mo for ~1000 queries" BYOK note.]

### Tavily

README cells only: `❌` open-source core, **`partial`** full content, `❌` multi-engine attribution, `❌` persistent corpus, `❌` trust score, `❌` self-hostable, **`partial`** MCP-native, `❌` BYOK. The two `partial`s are the honest part — Tavily does more than raw snippets and has some MCP story. The clean differences are ownership and memory: it is hosted, closed-core, and stateless across your sessions.

[GAP: verify Tavily pricing, free-tier limits, and exact MCP support level — not asserted in the README, do not fabricate.]

### Exa

README cells only: `❌` open-source core, **`partial`** full content, `❌` multi-engine attribution, `❌` persistent corpus, `❌` trust score, `❌` self-hostable, **`✅`** MCP-native, `❌` BYOK. Exa is the one competitor the README marks a full `✅` on MCP-native, so on the "does it speak MCP" axis it is a peer, not a laggard. The qsearch differences are the usual four: open core, multi-engine attribution, local corpus, trust score.

[GAP: verify Exa pricing, neural-vs-keyword search modes, and content-retrieval limits — README asserts only the eight comparison cells.]

### Serper

In the task brief but worth a line: Serper is in the README table (all `❌` across the eight dimensions). It is the snippet-API archetype the broader pitch contrasts against. I will not say more than the table does.

[GAP: verify Serper pricing and feature set — README asserts only the comparison cells.]

### Perplexity

This is the one I most have to be careful about. **Perplexity is not in the README comparison table at all.** I have no verified column for it, so I am not going to print feature checkmarks or prices I have not confirmed.

What I can say structurally, without claiming specifics: Perplexity is a hosted, closed product, which puts it on the opposite side of qsearch's open-source / self-hosted / BYOK line by definition of being a managed cloud service. Beyond that — its search API surface, pricing, retrieval behavior, and whether it exposes anything like a per-URL provenance signal — I have not verified, and I will not guess.

[GAP: verify Perplexity — does it offer a developer search API distinct from the consumer product; pricing/tiers; whether it returns full content or snippets; any multi-engine or provenance signal; MCP support. None of this is in the qsearch README; build a verified column before asserting any of it.]

---

## How to decide in thirty seconds

- **You want zero infrastructure and accept a vendor seeing your queries** → a hosted API (Tavily / Exa / Perplexity). Least work, fastest start.
- **You want a self-hosted metasearch box and nothing else** → SearXNG raw.
- **You want one independent web index behind a key** → Brave API (and note qsearch can wrap it).
- **You want full content, multi-engine provenance, a corpus that remembers, and an MCP server your agent calls directly — and you will run a daemon for it** → qsearch.

That last bullet is a real but narrow audience. I built qsearch because I am in it: 100-plus research sprints, an agent that kept inventing facts it never actually read, and a refusal to keep handing my entire search history to someone else's server. If that is not your problem, one of the other tools is genuinely the better pick, and I would rather you use the right one than the mine-shaped one.

---

## Try it

```bash
git clone https://github.com/theYahia/qsearch.git
cd qsearch
cp .env.example .env.local          # optionally set BRAVE_API_KEY for the focused/critical tiers
docker compose up -d                 # Meilisearch + Qdrant + SearXNG
npm install && npm start             # qsearch on :8080
npm run start:mcp                    # MCP-over-HTTP on :8081

# multi-engine attribution in one call
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'t1|self-hosted search engine 2026\n'
# → parsed_snippets.md with "Engines: google, duckduckgo, brave (count=3)"
```

Apache-2.0. Independent. BYOK. Self-hostable. No vendor lock-in.

- Repo: https://github.com/theYahia/qsearch
- Vision: https://github.com/theYahia/qsearch/blob/main/docs/VISION.md
- Technical spec: https://github.com/theYahia/qsearch/blob/main/docs/TRUST_MESH.md
- Live demo: https://qsearch.pro

If you read this far and think I got a competitor fact wrong, that is exactly the kind of issue I want filed. The table is maintained in the README; corrections land there first.
