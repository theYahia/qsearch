# Vision — qsearch is the trust layer for AI agent search

> **TL;DR:** AI agents lose 17-33% of facts to hallucination because they read snippets, not pages. qsearch is the open-source search layer that gives agents full content with multi-engine provenance — locally, with optional federation. Built on Brave + SearXNG + Meilisearch + Qdrant, MIT-grade open source, ready for MCP today.

---

## The problem

Every AI agent today does the same broken dance:

```
Agent: "what's the latest on X?"
   ↓
Tavily / Exa / Serper API
   ↓
20 results × 200-character snippets
   ↓
Agent reads snippets → hallucinates the rest
```

Three things break here:

**1. Snippets aren't enough.** Stanford's 2024 RAG study ([Magesh et al.](https://dho.stanford.edu/wp-content/uploads/Legal_RAG_Hallucinations.pdf)) measured production RAG systems — LexisNexis Lexis+ AI and Westlaw AI-Assisted Research — and found **17–33% hallucination rates** despite vendor claims of being "hallucination-free." When agents read 200 characters and pretend they read 2000, they invent the difference.

**2. No trust signal.** Search APIs return results in ranking order. The agent has no way to know if the top result is authoritative or SEO spam. So it trusts position, not provenance.

**3. No memory.** Every agent search starts from scratch. The same SEO trash gets surfaced again tomorrow. The same authoritative source goes unrecognized.

The result: agents that confidently make stuff up. Not because the LLM is bad — because the search layer feeds it shadows.

---

## What qsearch does

qsearch is a self-hosted search server that sits between your agent and the open web. It does three things differently:

```
Agent → qsearch → Brave + SearXNG (5+ underlying engines)
           ↓
   Multi-engine attribution: each URL tagged with which engines found it
           ↓
   Local corpus (Meilisearch + Qdrant): every URL accumulates
           ↓
   Trust score: log(sweep_count) × engine_diversity × topic_diversity
           ↓
   Re-ranked, full-content, provenance-tagged results back to agent
```

**Three concrete differences vs Tavily / Exa / Serper:**

1. **Multi-engine attribution exposed.** When SearXNG aggregates Google + DuckDuckGo + Brave + Qwant + Startpage and the same URL surfaces in 4 of them, that's a real signal. qsearch returns `engines: ["google", "duckduckgo", "brave", "qwant"]` per result. Existing search APIs hide this — they return one ranked list, no provenance.

2. **Full content, not snippets.** qsearch fetches and cleans full pages on demand. On Wikipedia-style QA, full-context beats snippet-RAG by **7.3pp** (56.3% vs 49.0% accuracy, [arxiv 2501.01880](https://arxiv.org/html/2501.01880v1)). DeepMind's [FACTS Grounding benchmark](https://deepmind.google/blog/facts-grounding-a-new-benchmark-for-evaluating-the-factuality-of-large-language-models/) defines factuality precisely as "fully grounded in the provided document." That's what qsearch passes through.

3. **Local-first trust.** Your corpus lives on your machine. Every search adds nodes. Authoritative URLs (high engine_count, high sweep_count, broad topic_diversity) emerge naturally over months of use. No central server can lie to you about your own search history.

---

## The 5 steps, concretely

```
┌──────────────────────────────────────────────────────────────┐
│ STEP 1 — agent searches                                     │
│   POST /search { query: "self-hosted search 2026", n: 20 } │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ STEP 2 — qsearch fans out                                   │
│   Brave Search API + SearXNG (Google, DDG, Brave, Qwant…)  │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ STEP 3 — multi-engine attribution returned                 │
│   URL_1: github.com/searxng/searxng                        │
│         engines: [google, ddg, brave, qwant, startpage]    │
│         engine_count: 5  ← found by ALL                     │
│   URL_2: random-blog.io/seo-spam                           │
│         engines: [google]                                   │
│         engine_count: 1  ← found by ONE                     │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ STEP 4 — local corpus accumulates (Meilisearch + Qdrant)   │
│   Each URL grows a profile: how many sweeps, which topics, │
│   which engines, when first seen                            │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ STEP 5 — re-rank by trust + return full content            │
│   trust(URL) = log(sweep_count + 1)                        │
│              × engine_diversity                             │
│              × topic_diversity                              │
│                                                             │
│   Top result: not the best-SEO'd URL.                       │
│              The most cross-validated URL.                  │
└──────────────────────────────────────────────────────────────┘
```

After 50 research sprints, your trust mesh distinguishes natural authority from SEO trash *automatically*. github.com/searxng/searxng appears in 5 sweeps × 5 engines × 4 topic clusters → trust ≈ 44. random-blog.io/seo-spam appears once → trust ≈ 0.7. The agent finally knows which to trust.

---

## Validated feedback loop (v0.6+)

The hard problem in self-improving search: how do you let agent feedback shape ranking *without* the system getting gamed?

Naive approach: count clicks/citations, raise trust accordingly. **Fails badly** — that's just SEO with extra steps. Adversarial agents flood feedback to boost their preferred sources.

Better approach: every signal must pass validation gates before it touches the corpus. Recent work — [Bidirectional RAG (arxiv 2512.22199)](https://arxiv.org/html/2512.22199v1) — demonstrates the architecture:

```
agent answer → 3 validation gates →  conditional corpus update

  Gate 1 — NLI grounding (DeBERTa-v3 ≥ 0.65 entailment)
  Gate 2 — attribution check (citations match retrieved docs)
  Gate 3 — novelty (semantic similarity to existing > 0.10)
```

Empirically: ~72% of candidate updates get rejected by these gates. Coverage improves +99.6% relative vs naive write-back. Bloat reduced 72%. Citation F1 doubles.

qsearch adopts this approach for v0.6+: agent feedback becomes a trust signal *only* after passing grounding + attribution + novelty gates. No reward hacking, no opaque ranking. Conservative bias — false negatives preferable to false positives, since corpus pollution is hard to reverse.

We explicitly rejected RLHF framing here. [arxiv 2412.06000 "Does RLHF Scale?"](https://arxiv.org/html/2412.06000v1) shows naive RLHF gains only +2.8pp with inverse scaling — gain drops as model size grows. The mechanism we want is validated retrieval, not policy optimization.

---

## Federation — research direction (v1.0+)

The interesting question: can multiple qsearch instances share trust scores without trusting each other?

The honest answer: **this is unsolved, and we're not pretending otherwise.**

Existing decentralized AI networks (e.g., validator-token systems) face severe stake-concentration problems. [Empirical analysis of one major network (arxiv 2507.02951)](https://arxiv.org/html/2507.02951v1) found **median 90% of stake controlled by 1% of wallets** across 64 subnets, with Gini coefficient near 0.98. "Decentralized" in name only. We won't ship the same shape and call it immutable.

What we will explore for v1.0+:
- **Local mesh first.** Your computer = your truth. Always works. Never lies.
- **Optional async aggregator.** Like Git/RSS — push when convenient, pull when needed. No "always online" requirement.
- **Validator economics that survive scrutiny.** Either deterministic verification primitives (Proof-of-Diligence-style, [arxiv 2402.07241](https://arxiv.org/html/2402.07241v2)), or social/witness-consensus models, or TEE attestation. We don't know which yet.
- **Final formula likely 70/30:** local trust always weighted 70%, federation contributes 30% max. Even if the federation gets gamed, your local mesh stays clean. Disable federation → solo mode still works.

If the federation can't be made un-gameable, we don't ship federation. Local trust mesh is the load-bearing feature, not federation.

---

## Architecture today (v0.3.1)

```
┌──────────────────────────────────────────┐
│  Your machine                            │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ qsearch :8080 (Node.js)             │ │
│  │  ├── /search   (web + corpus)       │ │
│  │  ├── /sweep    (batch label|query)  │ │
│  │  ├── /index    (URL or .md glob)    │ │
│  │  ├── /news, /context                │ │
│  │  └── MCP-over-HTTP :8081            │ │
│  └────────────────────────────────────┘ │
│           │                              │
│  ┌────────▼─────────────────────────┐   │
│  │ Meilisearch :7700  (full-text)   │   │
│  │ Qdrant :6333       (vector)       │   │
│  │ SearXNG :8888      (meta-search)  │   │
│  └────────────────────────────────────┘  │
│                                          │
│  Optional cleaning: llama.cpp embedder, │
│  any GGUF-compatible LLM for summary    │
└──────────────────────────────────────────┘
              ↓ (optional, async)
       Brave Search API (BYOK)
```

**Already shipped (v0.3.1):**
- Multi-engine attribution via SearXNG `engines[]` field — propagated through sweep → corpus → Meilisearch (filterable)
- Dual-sweep workflow (Brave + SearXNG on same queries) — tested, 30 queries × 2 backends in <1 min
- MCP-over-HTTP for Claude Code, OpenClaw, and any spec-compliant HTTP-MCP client
- Persistent corpus with auto-indexing from sweeps
- Cross-platform: Linux/macOS/Windows (Qdrant vector requires bare-runtime on Linux/macOS)

---

## Roadmap

| Version | What | When |
|---------|------|------|
| **v0.3.1** (today) | engines[] field + dual sweep + corpus + MCP | shipped |
| **v0.4** | Trust graph: ingest pipeline + trust formula + `/trust/:url` endpoint + simple viewer | 3-5 weeks |
| **v0.5** | Bidirectional RAG validated feedback loop — grounding + attribution + novelty gates | 6-8 weeks |
| **v0.6** | Optional aggregator service for opt-in federation (centralized v0.6, self-host Docker v0.7) | 3-6 months |
| **v1.0** | Federation with workable validator economics — *if* we solve the trust problem honestly | open |

---

## Why this matters

Search has been broken for AI agents since the first MCP server shipped. We've all watched our agents:

- Cite a 2-year-old Reddit post as authoritative
- Quote phantom statistics from snippets they never fully read
- Repeat the same SEO trash on every related query
- Have no idea which of three contradicting sources to trust

Every existing search API hides the signal we need (which engines agreed?). Every existing knowledge graph is enterprise-priced or vendor-locked. Every "decentralized search" project either vapored or got captured by stake concentration.

qsearch is what happens when you take search-for-agents seriously and refuse to make claims you can't back.

- Multi-engine attribution today (`engines[]` field, working code, commit `13fb0b1`).
- Trust graph this quarter.
- Validated feedback loop next quarter.
- Federation when (if) it can be done honestly.

No tokens. No "decentralized" theater. No promises about stake mechanics nobody has solved. Just an open-source search layer that compounds trust over time, runs on your machine, and tells your agent which engines actually agreed.

---

## How to try (5 minutes)

```bash
# 1. Clone
git clone https://github.com/theYahia/qsearch.git
cd qsearch

# 2. Get a Brave Search API key (BYOK, $5/mo for ~1000 queries)
#    https://brave.com/search/api/ → sign up → copy key
cp .env.example .env.local
# Set BRAVE_API_KEY in .env.local
# Optional: SEARXNG_URL=http://localhost:8888 for multi-engine attribution

# 3. Start infrastructure
docker compose up -d

# 4. Run
npm install
npm start                # qsearch on :8080
npm run start:mcp        # MCP-over-HTTP on :8081

# 5. Test multi-engine attribution
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary $'t1|self-hosted search\n'
```

The output `parsed_snippets.md` will show `Engines: google, duckduckgo, brave (count=3)` lines under each URL — that's the trust primitive at work.

---

## Where to go next

- **Star the repo** if this resonates: [github.com/theYahia/qsearch](https://github.com/theYahia/qsearch)
- **Read the technical spec:** [docs/TRUST_MESH.md](TRUST_MESH.md)
- **Try the MCP integration:** [README.md#mcp-in-claude-code](../README.md)
- **File an issue / contribute:** PRs welcome on the trust formula, validation gates, federation design
- **Research backing this Vision:** [research/agent_trust_loop.md](../research/agent_trust_loop.md) (sprint synthesis with citations)

The promise is small and shippable. The vision is bigger but only ships when it survives scrutiny.

License: Apache-2.0. Independent, BYOK, self-hostable, no vendor lock-in.
