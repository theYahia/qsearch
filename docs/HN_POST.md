# Show HN: qsearch

## Title

```
Show HN: qsearch – OSS search API where LLM cleaning runs on your local machine
```

---

## Body (≤300 words, paste as-is into HN text field)

```
Tether shipped QVAC SDK (Apr 9) and WDK (Apr 13) — an edge-first open-source stack where inference, wallets, and agents run locally on your device, no cloud dependency. I've been building on it and hit the same wall every agent developer hits: the moment you need live web results, you either call Exa/Tavily (cloud cleaning) or parse raw HTML yourself.

qsearch closes that gap. It's a local HTTP server with one endpoint:

  POST /search { "query": "...", "n_results": 3 }

Two hops:
1. Brave Search API (BYOK — your key, your quota, no intermediary)
2. @qvac/sdk local LLM — Qwen3-0.6B Q4, 364MB, runs on your CPU

The response includes cleaned_markdown per result. That cleaning step — the part that decides what matters on a page — happens on your machine, not on a server I run. You can verify it by reading the code.

Real numbers from a laptop CPU:
  brave_ms: 819  ← Brave fetch (the only outbound hop)
  clean_ms: 1420 ← local Qwen3 inference

Honest trade-offs:
- Snippet quality is lower than Exa/Tavily — a 600M model can't beat a datacenter GPU
- Cold start takes a few seconds (364MB model load)
- Brave only in v0.1; SearXNG self-hosted is v0.2
- Self-host first — public demo at qsearch.pro, but designed for your own instance

The wedge is architectural, not quality. qsearch wins when you care that the cleaning step runs on your hardware end-to-end — not as a privacy policy promise, but as a property you can audit in the code.

Apache-2.0. Works on Windows/macOS/Linux. npm install && npm start.

Blog post with pipeline details: [BLOG.md in repo]
```

---

## Expected questions + answers

**"Why not just use Exa?"**
> Exa is excellent and I say so in the README. qsearch wins exactly one thing: the cleaning runs on your machine. If you're building a cloud app, use Exa.

**"Brave isn't truly independent — it shows Google/Bing results sometimes"**
> Brave has its own crawler (Brave Search index) and falls back to Bing/Google for long-tail queries. The ratio has improved significantly since 2023. For v0.1 it's the best BYOK option with explicit AI-transformation ToS permission. SearXNG is planned for v0.2.

**"364MB is too big for edge devices"**
> It's ~364MB RAM when loaded. On a phone, that's tight — on a laptop or Pi 5 (8GB), it's fine. QVAC SDK targets all of these. v0.2 adds model selection; QWEN3_1_7B is 1008MB for quality, not for constrained devices.

**"This is just a proxy with a local LLM bolted on"**
> Yes, exactly. The point is the architecture of where cleaning runs, not novelty of the mechanism.
```
