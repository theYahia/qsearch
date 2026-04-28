# qsearch — Real-world examples

> Snapshot from 2026-04-28. Corpus: 5569 docs, accumulated over multiple research sprints.
> Longitudinal trust evolution (multi-sweep URLs) will be added in update 2026-05-12 after 2 weeks of post-launch daily use.

---

## 1. Real corpus snapshot

After running ~100 research queries across multiple topics:

```
Total documents:       5569
URLs with engine_count ≥ 3:  63
  — engine_count = 4:   6 (found by Google + DDG + Brave + Startpage)
  — engine_count = 3:  45
  — engine_count = 2:  49 (in index, below high-trust threshold)
```

**Top 10 URLs by trust score (engine_count ≥ 3):**

| URL | engines | trust_score |
|-----|---------|-------------|
| pmc.ncbi.nlm.nih.gov/articles/PMC12649634/ | startpage, google, duckduckgo, brave (4) | 2.77 |
| glukhov.org/post/2025/06/yacy-search-engine/ | 4 engines | 2.77 |
| docs.bsky.app/blog/repo-export | 4 engines | 2.77 |
| gptzero.me/news/neurips/ | 3 engines | 2.08 |
| fortune.com/2026/01/21/neurips-ai-... | 3 engines | 2.08 |
| deepmind.google/blog/facts-grounding-... | 3 engines | 2.08 |
| awesome-selfhosted.net/tags/search-engines.html | 3 engines | 2.08 |
| coveo.com/blog/what-is-federated-search/ | 3 engines | 2.08 |
| arxiv.org/abs/2501.01880 | 3 engines | 2.08 |
| medium.com/@fardeenxyz/8-web-search-apis-... | 3 engines | 2.08 |

Trust formula: `log(sweep_count + 1) × engine_diversity × topic_diversity`

---

## 2. Multi-engine attribution in action

**High-trust URL** (engine_count=4):

```bash
curl "http://localhost:8080/trust/https%3A%2F%2Fpmc.ncbi.nlm.nih.gov%2Farticles%2FPMC12649634%2F"
```

```json
{
  "url": "https://pmc.ncbi.nlm.nih.gov/articles/PMC12649634/",
  "title": "Comparative Evaluation of Advanced Chunking for RAG in LLMs for Clinical Decision Support - PMC",
  "trust_score": 2.77,
  "engine_count": 4,
  "engines": ["startpage", "google", "duckduckgo", "brave"],
  "sweep_count": 1,
  "topic_diversity": 1
}
```

Why this matters: 4 independent search engines surfaced this URL for a query about RAG hallucination. It wasn't optimized for SEO across all engines — it just showed up because it's relevant. Strong signal.

**Lower-trust URL** (engine_count=2):

A typical SEO-optimized post showed up in 2 engines. It doesn't appear in `/corpus/top?min_engines=3` at all. You'd never know by looking at a search snippet whether it passed cross-engine validation — qsearch tracks this automatically.

---

## 3. SEO spam detection via engine count

I ran a sweep on "self-hosted search engine 2026" — a query with active SEO competition.

Results breakdown:
- 20 URLs returned by SearXNG
- 6 appeared in 3+ engines → high-trust subset
- 14 appeared in 1-2 engines → likely optimized for specific engines

The high-trust 6 included: YaCy documentation, awesome-selfhosted.net, a Hacker News thread, GitHub repositories. The 14-engine-single URLs included several "top 10 self-hosted tools" listicles.

No human ranking required. The trust signal emerged from the data.

---

## 4. Run it yourself — first sweep

```bash
echo "t1|self-hosted search engine 2026" > queries.txt
curl -X POST "http://localhost:8080/sweep?topic=demo" \
  -H "Content-Type: text/plain" --data-binary @queries.txt
```

Output excerpt (`parsed_snippets.md`):

```markdown
**1. YaCy: Decentralized Search Engine**
- URL: https://www.glukhov.org/post/2025/06/yacy-search-engine/
- Engines: startpage, google, duckduckgo, brave (count=4)
  > Decentralized peer-to-peer search engine, self-hostable...

**2. [SEO listicle]**
- URL: https://example-seo-blog.com/top-tools-2026
- Engines: google (count=1)
  > 10 best self-hosted search engines you must try...
```

URL #1 → `engine_count=4`. URL #2 → `engine_count=1`. The trust signal is built into the data, not bolted on.

---

## 5. MCP integration — daily research workflow

**`~/.claude/settings.json`:**

```json
{
  "mcpServers": {
    "qsearch": { "type": "http", "url": "http://localhost:8081" }
  }
}
```

**Daily commands I use:**

```
# Morning research sweep
mcp__qsearch__sweep — batch queries, auto-indexed into corpus with engines[]

# Quick lookup during a coding session  
mcp__qsearch__web_search — single query, corpus_first=true (hits local memory first)

# Bring in research notes
mcp__qsearch__index_research — glob a directory of .md files into the corpus

# News monitoring
mcp__qsearch__news_search — Brave news (requires BRAVE_API_KEY)
```

After 10+ sprints on the same domain, `GET /corpus/top?min_engines=3` shows which URLs survived multiple independent engines across multiple sessions. Those are the ones I actually trust.

---

## 6. Corpus browser at /ui

The corpus viewer at `http://localhost:8080/ui` shows:
- Search across all indexed documents (full-text via Meilisearch)
- Trust score + engine list per URL
- Sweep provenance (which sweeps contributed to each URL)
- Filter by engine_count threshold

No build step — vanilla JS, dark theme, works in any browser.

---

## 7. Dual sweep workflow (advanced)

For maximum coverage, run both backends on the same query file:

```bash
# Primary: Brave API (authoritative, parallel fetch)
python research/scripts/brave_sweep.py queries.txt _raw_data/topic_$(date +%Y-%m-%d)/brave/

# Secondary: qsearch (auto-indexed into corpus, multi-engine attribution)
curl -X POST "http://localhost:8080/sweep?topic=my_topic" \
  -H "Content-Type: text/plain" --data-binary @queries.txt \
  > _raw_data/topic_$(date +%Y-%m-%d)/qsearch/parsed_snippets.md
```

The Brave output is higher quality for synthesis. The qsearch output auto-indexes into the corpus and adds SearXNG's multi-engine attribution. Both stay local — no data leaves your machine.

See [QUICKSTART.md](./QUICKSTART.md) for full setup.
