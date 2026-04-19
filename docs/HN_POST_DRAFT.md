# Show HN Draft — qsearch

**Submit:** 2026-04-19 (Sunday), ~16:00-18:00 UTC

---

## Title (80 chars max)

```
Show HN: qsearch – search API where cleaning runs on your local LLM
```

---

## Body (~250 words)

```
I built qsearch because I was tired of the half-sovereign problem.

If you're building local-first AI (QVAC, Ollama, llama.cpp), your inference runs on your hardware. But the moment you add web search, you're back to trusting someone else's server to process your queries. Exa, Tavily, Sonar — they all clean results server-side. Your "local" agent now has a cloud dependency in the critical path.

qsearch is different: Brave Search for the raw fetch (BYOK — your API key, your quota), then @qvac/sdk runs Qwen3-0.6B locally to clean the snippets into markdown. The cleaning step — the part that touches your query semantics — never leaves your machine.

What it looks like:

    curl -X POST localhost:8080/search \
      -H "Content-Type: application/json" \
      -d '{"query": "QVAC SDK release notes", "n_results": 3}'
    
    → brave_ms: 819 (their latency)
    → clean_ms: 1420 (your inference)
    → cleaned_markdown: "QVAC SDK v0.8.3 released Apr 9..."

Trade-offs I'm upfront about:
- Snippet quality < GPT-4/Claude (it's a 600M model)
- Cold start ~3s on first query (model load)
- Brave-only in v0.1 (SearXNG planned for v0.2)
- Requires ~400MB disk for the quantized model

The code is ~500 lines. Apache-2.0. Works on Windows/Mac/Linux.

GitHub: https://github.com/theYahia/qsearch
Technical deep-dive: https://github.com/theYahia/qsearch/blob/main/BLOG.md

Built this in a week as part of a build-in-public experiment. Feedback welcome — especially from anyone else building local-first agent tooling.
```

---

## Checklist before submit

- [ ] Repo README has real curl output (not mock)
- [ ] BLOG.md is polished and linked
- [ ] v0.1.0 tag exists in releases
- [ ] `npm install && npm start` works clean on fresh clone
- [ ] No typos in HN post body
- [ ] Submit from account with some karma (not brand new)

---

## Backup titles (if main doesn't work)

1. `Show HN: qsearch – OSS search API with local LLM cleaning via QVAC`
2. `Show HN: qsearch – Brave search + local Qwen cleaning for AI agents`
3. `Show HN: I built a search API where snippet cleaning runs on your CPU`

---

## Expected questions & answers

**Q: Why not just use Exa/Tavily?**
A: If you're building SaaS, use them — better quality, zero ops. qsearch is for when you've already committed to local inference and don't want to break that contract for web search.

**Q: Why Brave specifically?**
A: Data-for-AI tier explicitly permits AI transformation of results (caching/re-use is not permitted — results must be processed in-memory). Google/Bing ToS are hostile to this use case. SearXNG support planned for a future release (fully self-hosted option).

**Q: 600M model seems small, is the quality good enough?**
A: For extracting key facts from search snippets, yes. It's not summarizing novels — it's pulling "version 0.8.3 released April 9" from a 200-char snippet. Bigger models (`QWEN3_1_7B`) available if you want better quality.

**Q: What's QVAC?**
A: Tether's edge-first AI SDK. Bundles quantized models, runs inference locally. qsearch uses it for the cleaning step. https://github.com/tetherto/qvac

**Q: Privacy claims?**
A: I'm not claiming "privacy-first" — your query still goes to Brave. The claim is architectural: the cleaning/processing step is local. If you want full privacy, wait for v0.2 SearXNG support.
