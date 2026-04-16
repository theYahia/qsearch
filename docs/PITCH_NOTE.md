# qsearch — Pitch Note

*For Tether conversation 2026-04-21. Internal, not published.*

---

## One-line

> I spent 48 hours building on QVAC with no insider access. Here's what shipped — and here's where it goes.

**Alt one-liner (if asked "what is qsearch"):**
> "Workbench reads your docs, qsearch reads the web — both locally, both private, both QVAC-powered."

---

## What shipped (Apr 14-15, all ahead of schedule)

| Artifact | Details |
|----------|---------|
| Working search API | `npm install && npm start` → `POST /search` with Brave + QVAC cleaning |
| v0.1 live (v0.2 in testing) | 22+ commits, full pipeline proven on Windows 11 x64 |
| v0.2 endpoints (local, not yet pushed) | /search ✅ tested, /news + /context + /health + MCP tool = coded, need testing |
| Blog post | "Why cleaning needs to run on your hardware, not ours" |
| PRD | Anchored to Tether's verbatim TPM KPI categories |
| Workbench integration doc | MCP tool schema + sidecar pattern |
| Apache-2.0 | Same as QVAC — zero-friction to upstream |
| WDK_tether repost | Day zero, before any code |

**Stack:** Node.js ≥20, @qvac/sdk 0.8.3, Qwen3-0.6B Q4 (364MB), Brave Data-for-AI tier.
**Benchmarks:** brave_ms ~800ms, clean_ms ~1.1s per result (laptop CPU).
**Research:** 7 deep sprints, 120+ Brave API queries, competitive landscape, pricing analysis, P2P stack code review.

---

## The architecture argument (30 seconds)

Tether shipped QVAC (Apr 9) and WDK (Apr 13). The stack: local inference + local documents + self-custodial wallet. What's missing: the live web.

Every search API today sends the query to their server → their LLM cleans it → their server answers. An agent running on QVAC with local health data is *half-sovereign* the moment it calls Exa.

qsearch: Brave fetch (BYOK, one outbound hop) + @qvac/sdk local cleaning (your CPU, zero outbound). `brave_ms` is their latency. `clean_ms` is yours. Verifiable in `src/server.js`.

---

## The market (researched, not guessed)

| Fact | Source | Verified |
|------|--------|----------|
| Exa: $85M Series B, **$700M valuation**, $10M ARR | Benchmark capital | ✅ |
| Tavily: **acquired by Nebius** (Nvidia) Feb 2026 | theblock.co | ✅ |
| Brave: 200K+ devs, **killed free tier** → $5/mo | brave.com | ✅ |
| Perplexity Sonar: **no free tier** at all | docs.perplexity.ai | ✅ |
| Bing Search API: **dead** (Aug 2025) | microsoft.com | ✅ |
| Agentic AI market: **$7.29B → $139B** by 2034 (40.5% CAGR) | industry report | ✅ |
| **Zero** projects combine P2P + AI cleaning + web search | 120+ Brave queries | ✅ |
| QVAC SDK has embeddings, **no RAG module** | qvac.tether.io | ✅ |
| Vitalik Buterin runs SearXNG + local LLM (Apr 2026) | personal blog | ✅ |

---

## Why these decisions (taste signals)

**Apache-2.0** — same as QVAC. Zero-friction to upstream.

**Brave, not Exa/Tavily** — independent index (40B pages), Data-for-AI ToS, BYOK. Tavily charges 60% more than raw Brave ($8 vs $5) and doesn't have its own index.

**Local cleaning** — the wedge. Brave LLM Context API uses Qwen3 server-side — same model family. Difference is architectural: where the cleaning runs.

**No hosted tier** — deliberate. Differentiators are architectural. Everything else is v2.

---

## Vision: P2P Knowledge Network (post-hire)

> "qsearch is not a search API. It's the first P2P knowledge network for AI agents on your stack."

### How it works

```
Agent queries → local Hyperbee cache (instant, $0)
  miss → Hyperswarm peer query (sparse, <10ms)
    miss → Brave API ($0.005) → QVAC cleaning → store → replicate to all peers
```

**Each query makes the network smarter.** 1000 agents × 100 queries/day = cache hits → free and instant. Network effect = moat.

### Why only Tether can build this

| Component | Your repo | Role |
|-----------|----------|------|
| P2P discovery | hyperswarm | Find peers |
| P2P database | hyperbee | Cache results (sparse query = no full download) |
| Replication | corestore | One call syncs everything |
| Local AI | @qvac/sdk | Cleaning + embeddings |
| Payments | wdk | x402 micropayments per query |
| Chat integration | keet-bot-sdk | AI search in Keet rooms |

MiningOS manages 100K+ ASICs on the same Hyperswarm stack. This is production infrastructure, not vaporware.

### Academic validation

DRAG paper (arxiv 2505.00443) — "Distributed Retrieval-Augmented Generation" — proves near-centralized RAG quality with 50% fewer messages using Topic-Aware Random Walk routing. Exactly our architecture.

### Revenue model

x402 protocol (Coinbase + Stripe + AWS) standardizes HTTP 402 for machine payments. qsearch nodes earn per cache hit via Lightning/USDC micropayments. Not SaaS subscription — network economics.

### Roadmap (with insider access)

| Version | What | Timeline |
|---------|------|----------|
| v0.3 | SearXNG free fallback | Week 1 |
| v0.4 | Local Hyperbee cache | Week 2 |
| v0.5 | QVAC embeddings (semantic cache) | Week 3 |
| v0.6 | Hyperswarm P2P sharing | Week 4-5 |
| v0.7 | x402/L402 payments | Week 6-7 |
| v1.0 | Keet Bot + A2A Protocol | Week 8 |

### The gap qsearch fills

QVAC SDK has embeddings but **no RAG module**. Hyperbee has P2P storage but **no search layer**. Nobody has connected the two. qsearch = the missing RAG layer for QVAC ecosystem.

---

## The ask

> A seat at the edge-stack table. I've spent a week building on QVAC with no insider access — give me insider access and I ship the P2P knowledge network in two months. All the building blocks are your repos.

---

## Build-in-public proof

- WDK_tether repost on day zero (before any code)
- Full pipeline shipped in 48 hours, 4 days ahead of schedule
- 22+ commits, each timestamped
- 7 deep research sprints (120+ Brave queries) — I understand your stack
- Honest trade-offs in README and blog
- `git clone && npm install && npm start` works

---

## If asked about gaps

**"Snippet quality?"** — 600M model. Not competing on quality. Competing on architecture. Upgrade path: one constant swap.

**"Brave dependency?"** — SearXNG v0.3 = free fallback. P2P cache v0.6 = Brave optional.

**"Why so small?"** — Every feature I don't ship is a feature I can't be wrong about.

**"P2P search = graveyard (YaCy, Presearch)"** — "I'm not building a P2P search engine. I'm building AI-cleaned results shared P2P. Each step does one thing well. Different architecture."

**"Mobile NAT broken on cell networks?"** — "Correct. v0.6 P2P is desktop-first. Mobile via relay peers. Honest about this."

**"Why does local matter, really?"** — "Anthropic already requires government ID for new Claude subscribers. Not regulators — their own decision. Regulation is coming. Local QVAC inference + local qsearch cleaning = AI without KYC, without tracking, without identity binding. This is not paranoia — it's already happening."

**"How is this different from Context Overflow / clawmem?"** — "They're centralized. qsearch runs on your P2P stack — Hyperswarm, Hyperbee, QVAC. No central server. The index lives on the network."

---

## Delivery rules

- One prepared phrase per topic change, max.
- Let them open the door, then walk through.
- Silence is fine.
- Lead with shipped code, not vision. Vision only if they ask "what's next."

---

*Pitch phrases reference: Claude memory `project_pitch_phrases.md`. This note is not public.*
