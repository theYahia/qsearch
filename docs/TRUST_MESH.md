# Trust Mesh — Technical Spec

> Companion to [VISION.md](./VISION.md). This doc covers the *how* — data structures, formulas, validation gates, federation protocol sketch, and honest limitations.

---

## Core data model

Every result that flows through qsearch becomes (or updates) a corpus document:

```typescript
interface CorpusDoc {
  id: string                    // hash(url)
  url: string
  title: string
  text: string                  // full content if /context fetched, else snippet
  description: string

  // Multi-engine attribution (NEW in v0.3.1)
  engines: string[]             // ["google", "duckduckgo", "brave", "qwant", ...]
  engine_count: number          // engines.length, denormalized for filter speed
  backend_source: string        // "searxng" | "brave" | "corpus"

  // Sweep provenance
  sweep_label: string           // which query found this URL
  namespace: string             // "sweep" | "index" | "user"
  crawled_at: string            // ISO timestamp

  // Trust signal (computed in v0.4)
  sweep_count?: number          // distinct sweeps containing this URL
  topic_diversity?: number      // distinct sweep topics
  trust_score?: number          // see formula below
}
```

`engines[]`, `engine_count`, `namespace`, `backend_source`, `sweep_label` are all `filterableAttributes` in Meilisearch — so you can do:

```bash
# All URLs found by 3+ engines
filter='engine_count >= 3'

# All URLs found by Google AND Brave
filter='engines IN ["google"] AND engines IN ["brave"]'

# High-trust URLs from sweeps (not user-indexed)
filter='engine_count >= 3 AND namespace = "sweep"'
```

This is the foundation. Without it, no trust formula is possible.

---

## Trust formula (v0.4)

```
trust(url) = log(sweep_count + 1) × engine_diversity × topic_diversity

  where:
    sweep_count       = COUNT(distinct sweeps containing url)
    engine_diversity  = COUNT(distinct engines across all sweeps for url)
    topic_diversity   = COUNT(distinct topics across sweeps containing url)
```

**Example (after 50 research sprints over 6 months):**

| URL | sweep_count | engine_diversity | topic_diversity | trust |
|-----|-------------|------------------|-----------------|-------|
| github.com/searxng/searxng | 5 | 5 | 4 | log(6)×5×4 = **35.8** |
| arxiv.org/abs/2501.01880 | 3 | 4 | 2 | log(4)×4×2 = **11.1** |
| medium.com/seo-trash | 1 | 1 | 1 | log(2)×1×1 = **0.7** |
| stackoverflow.com/q/12345 | 8 | 3 | 5 | log(9)×3×5 = **33.0** |

The log dampens runaway growth from a few high-frequency URLs. Engine and topic diversity are linear because they're harder to fake (need actual independent agreement / topical breadth).

**Why these three signals:**

- **sweep_count** — natural authority emerges when you keep finding the same URL across different research sprints.
- **engine_diversity** — adversarial SEO can game one engine but coordinating across Google + DDG + Brave + Qwant + Startpage is much harder. Each independent engine adds Byzantine-fault resistance.
- **topic_diversity** — a URL relevant across 5 different topics (e.g., crypto + agents + open source + RAG + privacy) is more authoritative than one stuck in a single niche.

---

## Validated feedback loop (v0.5)

Adopting [Bidirectional RAG (arxiv 2512.22199)](https://arxiv.org/html/2512.22199v1) approach. Every agent-side feedback signal must pass three gates before it touches the corpus:

```
Agent generates answer
    ↓
[Gate 1] NLI grounding check
    DeBERTa-v3 entailment ≥ 0.65
    "Does this answer entail from the cited URLs?"
    ↓ pass
[Gate 2] Attribution check
    Citations in answer must match URLs in retrieval set
    "Did you actually cite what you retrieved?"
    ↓ pass
[Gate 3] Novelty check
    Semantic similarity to existing corpus < 0.10 (i.e., >0.10 distance)
    "Is this signal new info or duplicate?"
    ↓ pass
Corpus update accepted → trust signal applied
```

**Empirical evidence (from Bidirectional RAG paper):**
- 72% of candidate updates rejected by gates (good — false negatives preferable to false positives)
- Coverage +99.6% relative vs naive write-back
- Citation F1 33.03% vs 16.75% naive
- 71s latency vs 31.9s (2.2× cost — opt-in for /agent-feedback endpoint)

**What we explicitly reject:**
- RLHF-style reward optimization. [arxiv 2412.06000](https://arxiv.org/html/2412.06000v1) shows it scales badly (+2.8pp gain, inverse scaling). Validated retrieval is the correct mechanism, not policy gradient updates.
- Click-through learning. Adversarial agents can manufacture clicks. Gates above are content-validated, not behavior-validated.

---

## Federation protocol (LOCKED architecture, v0.5+)

After 10-sprint comprehensive research (April 28, 2026 — see [`docs/FEDERATION_ARCHITECTURE.md`](./FEDERATION_ARCHITECTURE.md)), federation architecture is fully specified. No more oscillation.

### Async pull model (not always-online P2P)

```
Your qsearch (always works locally)
    ↓ (optional, manual or cron)
    ↓ HTTPS push (signed)
Aggregator service (qsearch.pro/mesh or self-hosted)
    ↓ aggregates signals across users
    ↓ (optional, manual or cron)
    ↓ HTTPS pull
Your qsearch
    ↓ uses global signals as 30% weight in final trust
```

Computer offline ≠ broken. Sync when online; works regardless. No 24/7 hosting requirement.

### Submit format

```typescript
interface FederationSubmit {
  url: string                   // the URL being attested
  reporter_id: string           // anonymous keypair public key
  timestamp: string             // ISO datetime
  signals: {
    engine_count: number        // engines that found this URL
    engines: string[]           // which engines (audit signal)
    sweep_count: number         // how many sweeps in reporter's local mesh
    topic_diversity: number     // distinct topics
    trust_score: number         // local trust per reporter
  }
  signature: string             // ed25519 signature over above
}
```

No queries, no personal data, no IDs (only ephemeral keypair). Reporter can rotate keys per submission.

### Final trust formula (with federation)

```
final_trust(url) = (local_trust × 0.7) + (global_trust × 0.3)

  where:
    local_trust  = trust formula above (v0.4)
    global_trust = aggregator's median trust across N reporters

  user controls weight: federation_weight ∈ [0.0, 0.5]
  default 0.3, max 0.5 (local always >= 50%)
```

**Why 70/30:** Even if 50% of federation reports are fake, your local trust dominates. Disable federation (`federation_weight = 0`) → solo mode, full local trust. No central server can lie to you about your own search history.

---

## Anti-Sybil — layered defense (NO blockchain/tokens)

After research validation, layered defense is the proven blockchain-free approach (Sprint E, confidence 70%):

### Layer A: Subscription-based trust scoping
Sybil only matters if user subscribes. Default = explicit allowlist of trusted feeds. Bad actor in subscription → user unsubscribes → solved.

### Layer B: WoT graph filtering (primary mechanism)
Aggregator stores graph of subscribed feeds + feeds they trust. Only count signals from feeds within graph distance N (typically 2-3 hops). Adopted from Nostr's NIP-13 + fiatjaf's WoT spam filter (production-proven on relays).

### Layer C: Per-instance allowlists/invites
Aggregator operators can require invite or domain attestation before accepting feeds. Reduces bot-farm scaling.

### Layer D: Adjustable PoW per relay
NIP-13-inspired difficulty target — submitter must compute proof-of-work matching aggregator's threshold. Configurable (8-30 bits depending on attack pressure).

### Layer E: Shared spam blocklists
Aggregators publish + share blocklists of known-bad feeds. DKIM/SPF/DMARC equivalent for federation.

### Layer F: DKIM-style domain attestation
Feed publisher's domain signs feed delivery. Reputation tied to domain (which has cost to acquire and reputation to lose).

### Layer G: Engine diversity weighting
For our specific case: weight engines by independence. Bing+Yandex correlated (shared crawls); Brave+Google not. Effective engine_count = N × diversity_factor.

### Layer H: Snippet sanitization
Before LLM hand-off, strip hidden CSS, font-size:0, comment blocks, `<!-- ai-instruction -->` patterns. Mitigates Preference Manipulation Attacks ([arxiv 2406.18382](https://arxiv.org/html/2406.18382v1)).

### Honest limitation
**No blockchain-free stack achieves UNCONDITIONAL Sybil resistance.** Sprint E concluded with 90% confidence: "every Sybil-resistance mechanism imports an assumption from somewhere." We accept threshold-based, assumption-based security. Our threat model is **search index federation, not financial consensus** — bar is lower.

### Why we DON'T use crypto-economic stake
[Bittensor empirical analysis (arxiv 2507.02951)](https://arxiv.org/html/2507.02951v1) on 64 subnets, 121,567 wallets:
- Median 90% stake controlled by 1% of wallets
- Gini coefficient 0.9825 (near max inequality)
- >50% subnets vulnerable to <1% wallet coalition takeover

Stake-based "decentralization" centralizes in practice. We use **subscription + WoT + DKIM + PoW** instead.

---

## What's shipped today (v0.3.1)

- ✅ `engines[]` field flows through SearXNG → result → parsed_snippets.md → Meilisearch
- ✅ Filterable attributes: `engines, engine_count, namespace, backend_source, sweep_label`
- ✅ Dual-sweep workflow (Brave + SearXNG on same queries) with separate output dirs
- ✅ Dedup with engines union when same URL appears in multiple queries
- ✅ MCP-over-HTTP at `:8081` with 5 tools (web_search, news_search, sweep, index_research, context_search)
- ✅ Cross-platform corpus (Linux/macOS full; Windows full-text only — Qdrant needs bare-runtime)

## Verification

You can verify the engines[] attribution end-to-end right now:

```bash
# 1. Start services
docker compose up -d
npm start

# 2. Run a sweep
echo "t1|self-hosted search engine 2026" > /tmp/q.txt
curl -X POST http://localhost:8080/sweep \
  -H "Content-Type: text/plain" \
  --data-binary @/tmp/q.txt > /tmp/output.md

# 3. Confirm Engines: lines in markdown output
grep "Engines:" /tmp/output.md

# 4. Confirm engines[] in Meilisearch document
curl -H "Authorization: Bearer masterKey" \
  "http://localhost:7700/indexes/qsearch_corpus/documents?filter=engine_count%20%3E%3D%202&limit=5" \
  | jq '.results[] | {url, engines, engine_count}'
```

Expected output: URLs found by Google + DDG + Brave (or other engine combos), with explicit attribution. URLs found by only Google get `engine_count=1` (the SEO-spam tier). URLs found by 3+ get `engine_count >= 3` (the trust tier).

This is the trust primitive. Everything else (formula, validated feedback, federation) builds on top of it.

---

## License

Apache-2.0 — see [LICENSE](../LICENSE). Independent. BYOK. Self-hostable.
