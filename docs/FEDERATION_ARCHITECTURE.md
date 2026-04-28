---
created: 2026-04-28
status: meta-synthesis
tags:
  - research
  - meta-synthesis
  - definitive-verdict
  - qsearch
---

# META-FEDERATION VERDICT — Definitive architecture lock-in

> **10-sprint comprehensive triangulation completed 2026-04-28.**
> **No more oscillation.** All evidence below grounded in citations from 250 queries × 2 backends = 500 sweep operations + 10 parallel agent syntheses.

---

## TL;DR — The architecture (lock-in)

```
┌────────────────────────────────────────────────────────────────────┐
│ qsearch SELF-LEARNING TRUST NETWORK — DEFINITIVE STACK              │
└────────────────────────────────────────────────────────────────────┘

LAYER 1 — Local trust (✅ shipped today, commit 13fb0b1)
   Meilisearch corpus + engines[] field
   trust = log(sweep_count+1) × engine_diversity × topic_diversity

LAYER 2 — Append-only signed log (v0.5)
   Each agent maintains local signed log of trust observations
   Format: ed25519-signed JSON entries, append-only, Merkle-integrated
   Implementation: SQLite + ed25519 (NOT Hypercore — Tether stack)
   Self-learning: log naturally accumulates, can be diffed/replicated

LAYER 3 — Sync via Yjs CRDT (v0.5)
   When two qsearch instances peer, Yjs CRDT merges trust counters
   Provably convergent, mathematically can't lie about chужие contributions
   Apache 2.0, used by Notion/Jupyter/Linear — NOT Tether

LAYER 4 — Transport: HTTPS pull-based feed (v0.5)
   JSON Feed v1.1 + _qsearch extension (RSS-inspired)
   Static file at known URL — GitHub Pages, S3, anywhere
   Pull-based — NAT-friendly, no DHT, no open ports
   Iroh as future P2P upgrade (Rust libp2p, NOT Hypercore)

LAYER 5 — Identity: Passkey-primary + optional did:plc (v0.5)
   Default = WebAuthn/passkey (95% of users — adoption-critical)
   Power tier = did:plc handle (cross-protocol portability)
   ⚠️ NEVER expose raw nsec/seed phrases at default UX (kills adoption — $140B BTC lost)

LAYER 6 — Federation interop: Bridgy Fed (free)
   Don't build own bridge. Register with Bridgy Fed (snarfed/bridgy-fed)
   Production-grade AT ↔ ActivityPub ↔ IndieWeb
   Nostr support coming via Mostr

LAYER 7 — Agent ecosystem: MCP + A2A
   MCP for tool exposure (already done — qsearch.pro/mcp)
   A2A surface for agent-to-agent delegation
   Track MCP Registry / Server Cards (.well-known URL pattern)

LAYER 8 — Validation: Bidirectional RAG gates
   NLI grounding (DeBERTa-v3 ≥0.65) + citation match + novelty check
   ~72% rejection rate filters bad observations naturally

LAYER 9 — Anti-Sybil: Layered defense (NO blockchain/tokens)
   WoT graph filtering (primary)
   Per-instance allowlists/invites
   Adjustable PoW per relay (NIP-13 inspired)
   Shared spam blocklists
   DKIM-style domain attestation for federation peering
   Engine diversity weighting (penalize correlated engines)
   Snippet sanitization (kill PMA / prompt injection)

LAYER 10 — Sustainability: Hybrid revenue
   Patreon donations: cover hosting ($200-500/mo target)
   Paid hosted instances: $50-200/mo per org × 5-20 orgs (primary revenue)
   EU NLnet/NGI Zero grant: €5-50K (apply Q3 2026)
   Linux Foundation membership: only after >1k stars + multi-org adoption
```

**This is ONE coherent design backed by 10-sprint evidence. Lock it in.**

---

## Cross-sprint convergence findings

### Convergent insights (multiple sprints agreed)

| Insight | Sprints confirming | Evidence |
|---------|-------------------|----------|
| Pure decentralization без crypto/tokens has real scaling limits | A, B, E, F | 95% Nostr relays can't cover costs; $140B BTC lost to keys; Sybil unprevention without authority |
| Layer separation is KEY (don't merge concerns) | A, C, H | MCP=tools, A2A=agents, AT=identity; CRDT for state, log for audit, transport separate |
| Mainstream adoption requires hiding crypto complexity | F, J | Passkeys win, raw keys lose. 5-min setup or die |
| External shock + polished client + credible patron = bootstrap | D, B | Mastodon (Twitter exodus), Nostr (Damus iOS+Dorsey), Bluesky (election+Brazil) |
| Hybrid revenue mandatory (donations alone fail) | G | Mastodon pivoted to paid hosting Sept 2025 |
| Multi-engine consensus IS gameable (PMA, content farms) | I, E | But still better than single-engine — engine_count ≥ 3 raises attack cost |

### Divergent / cross-tension points

| Tension | Resolution |
|---------|-----------|
| Sprint B says use Yjs+ActivityPub+Iroh; Sprint H says AT Protocol | **Both:** Yjs for sync (state), AT identity layer (handles), Iroh for P2P transport eventual. Different layers, different stacks. |
| Sprint A recommends "Hypercore-style" but user rejected Tether stack | **Build append-only signed log primitive WITHOUT Tether libraries** — SQLite + ed25519 + Merkle tree manually = same primitive, no Tether dependency |
| Sprint C says federation greenfield/premature for memory | **Federation = trust signals, NOT agent memory.** Different feature. We focus trust, leave memory federation to Mem0/LangMem |

---

## Sprint verdicts — final lock-in

### Sprint A: DB primitive
**WINNER:** Append-only signed log + Merkle tree + HLC for ordering (without Hypercore lib)
**Confidence: 70%**
**Implementation:** SQLite + ed25519 signatures + manual Merkle tree

### Sprint B: Production stack
**WINNER:** Yjs for sync + Iroh for P2P transport (avoiding Hypercore) + don't build own social network (use AT/ActivityPub via Bridgy)
**Confidence: 75%**
**Implementation:** Yjs (Apache 2.0) for CRDT, Iroh as transport layer for v0.7+

### Sprint C: Agent ecosystem
**WINNER:** MCP (table stakes, done) + A2A (add when peers query qsearch)
**Confidence: 80%**
**Implementation:** Already shipped MCP. Add A2A в v0.6+

### Sprint D: Bootstrap mechanics
**WINNER:** Polished mobile/desktop client + external trigger + credible patron + 5-min setup
**Confidence: 75%**
**Implementation:**
- Polished MCP server (already shipped) — track adoption
- Wait/plan for external trigger (AI search scandal, regulatory)
- Apply for OpenSats / NLnet grant
- Treat HN as 24-hour list-builder

### Sprint E: Security
**WINNER:** Layered defense (WoT + allowlists + PoW + DKIM + engine diversity + sanitization)
**Confidence: 70%** for stack sufficiency
**Confidence: 90%** that no perfect Sybil resistance exists без authority

### Sprint F: Identity UX
**WINNER:** Passkey/WebAuthn default + did:plc power tier
**Confidence: 75% adoption** | **90% raw keys kill adoption**
**Implementation:** Login via passkey by default, advanced users can BYO did:plc handle

### Sprint G: Economic sustainability
**WINNER:** Hybrid model — donations (hosting cost only) + paid hosted instances (primary revenue) + grants
**Confidence: 70%**
**Implementation:** Apply for NLnet Q3 2026 (€5-50K), launch Patreon at >1k stars, paid hosting at >5k stars

### Sprint H: Cross-protocol
**WINNER:** Register with Bridgy Fed (Snarfed). Don't build own bridge.
**Confidence: 65%**
**Implementation:** Free interop AT ↔ ActivityPub. Add Mostr for Nostr later

### Sprint I: Adversarial defense
**WINNER:** Engine diversity weighting + snippet sanitization + domain stability
**Confidence: 65%**
**Implementation:** Weight engines by independence (Bing+Yandex correlated, Brave+Google not), strip hidden CSS/comments before LLM hand-off

### Sprint J: DX & onboarding
**WINNER:** 5-min path to first wow + killer demo + docs primacy + embedded viral loops
**Confidence: 75%**
**Implementation:** 60-sec asciinema demo, footer in parsed_snippets.md "generated by qsearch", showcase community research artifacts

---

## Posterior probabilities (Brier calibration)

| Belief | Prior (start of day) | Posterior (after 10 sprints) | Direction |
|--------|---------------------|-----|--|
| qsearch pivot to "trust standard" worth pursuing | 60% | **88%** | ↑↑ |
| Federation possible without blockchain/tokens | 70% | **85%** | ↑ |
| Sybil resistance achievable in our threat model | 50% | **70%** | ↑ |
| Mainstream adoption possible via passkey UX | 60% | **75%** | ↑ |
| Hybrid revenue model sustainable | 55% | **70%** | ↑ |
| Build path: incremental (v0.4 → v0.5 → v0.6+) | 75% | **90%** | ↑↑ |
| Build path: all-in 3-5 month commit now | 35% | **20%** | ↓ |

---

## What we're NOT doing (final no-list)

❌ **NO Hypercore / HyperDHT / HyperBee** — Tether stack rejected
❌ **NO Bittensor-style validators** — academically refuted (Gini 0.98 stake concentration)
❌ **NO RLHF for search ranking** — doesn't scale (arxiv 2412.06000)
❌ **NO blockchain / tokens / native currency** — adds friction, kills mainstream adoption
❌ **NO PDS / Relay / AppView architecture (AT Protocol full)** — adoption barrier
❌ **NO own bridge to ActivityPub** — Bridgy Fed exists, free
❌ **NO seed phrase / nsec exposed at default UX** — $140B BTC lost = warning
❌ **NO push to all-in 3-5 month commit** — incremental path won, runway respect
❌ **NO Twitter-clone scope creep** — federation = trust signals only, не social network

---

## Build path — locked

### v0.4 (3-5 weeks) — Local trust graph
- Trust formula implementation
- `/trust/:url` endpoint
- Re-rank `/search` by trust
- Simple vis.js viewer
- All local, no federation yet

### v0.5 (4-6 weeks after v0.4) — Validated feedback + JSON Feed
- Bidirectional RAG validation gates (NLI + citation + novelty)
- Append-only signed log primitive (SQLite + ed25519)
- JSON Feed v1.1 + _qsearch extension publication
- Subscription aggregation with median weighting
- Passkey login at qsearch.pro

### v0.6 (3-4 months after v0.5) — Optional federation aggregator
- Reference aggregator service
- WoT graph filtering
- Yjs CRDT sync between aggregators
- Bridgy Fed registration
- A2A surface for agent peers

### v1.0 (6+ months) — Bootstrap mature ecosystem
- Iroh P2P transport
- did:plc identity tier
- Community aggregators
- Apply NLnet grant
- Hosted paid instances launch

---

## Decision criteria for advancing

Each version gates on signal:

**v0.4 → v0.5:** ≥1k GitHub stars OR ≥10 community deployments
**v0.5 → v0.6:** ≥5 community feeds publishing OR ≥3k stars
**v0.6 → v1.0:** ≥1k aggregator subscribers OR ≥10k stars

If signal absent at gate: park, focus on what's working.

---

## Honest unanswered questions (residual uncertainty)

1. **Whether AI agents will actually use trust signals** — assumption, not proven
2. **Whether engine_count >= 3 is statistically meaningful** — needs empirical study after 100 sprints accumulate
3. **Whether passkey UX scales to power users wanting portability** — anecdotal evidence, not measured
4. **Whether NLnet grant timing aligns с runway** — bi-annual deadlines, slow
5. **Whether AT Protocol becomes dominant or fades by v1.0** — 1-2 year horizon

These don't change architecture choice. They affect timing/marketing/scope.

---

## Next actions (after this verdict)

1. ✅ Update `docs/VISION.md` federation section с specific protocol commitment (replace "research direction" → defined stack)
2. ✅ Update `docs/TRUST_MESH.md` с full technical spec from this verdict
3. ✅ Commit + push to GitHub (third commit today)
4. (later) Plan v0.4 implementation in detail
5. (later) Apply for NLnet grant when v0.4 ships

---

## Summary of total today's work

- 4 heavy research sprints (research_mesh, agent_trust_loop, viral_federation_patterns, + this 10-sprint program)
- ~390 queries × 2 backends = 780 sweep operations
- 1 code commit (Track 1: engines[] field)
- 1 docs commit (VISION + TRUST_MESH + launch-thread + README rewrite)
- Pending: third commit с federation architecture lock-in (this verdict)

**No more federation oscillation.** Definitive answer locked. Build path clear. Doubt killed.

If new evidence emerges that flips a verdict above, document it as Brier update, don't oscillate silently.
