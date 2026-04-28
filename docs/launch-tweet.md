# qsearch launch tweet

## FINAL — 3 variants ≤280 chars (pick Tuesday morning, post Mon 2026-05-04 evening UTC)

### Variant A — data-first (245 chars)

```
Stanford measured 17-33% hallucination in production RAG agents. My theory: they read 200-char snippets, not pages.

Built a fix: qsearch — open-source search layer with multi-engine provenance. Apache 2.0, MCP-native.

github.com/theYahia/qsearch
```

### Variant B — primitive-first (242 chars)

```
qsearch v0.4.0 ships today: open-source search layer for AI agents with engines[] provenance.

URL surfaces in 4 search engines = real. Surfaces in 1 = possibly SEO trash. Trust signal in the data.

Apache 2.0, MCP-native: github.com/theYahia/qsearch
```

### Variant C — dev-pain (238 chars)

```
If you've fought Tavily/Exa/Brave returning 200-char snippets while your agent hallucinated:

qsearch fetches full pages + tracks engines[] per URL — multi-engine consensus = trust signal.

Apache 2.0, Docker, MCP. github.com/theYahia/qsearch
```

> Note: Twitter t.co wraps URLs to 23 chars regardless of source length, so all three are well under the 280-char hard limit.

## Pre-launch teaser (Mon 2026-05-04 evening UTC, NO HN link yet)

```
⏳ Tomorrow I ship qsearch v0.4.0 — the open-source search layer for AI agents.

Stanford measured production RAG agents hallucinate 17-33% of facts.
My theory: it's because they read snippets, not pages.

Built a fix. Apache 2.0. Tomorrow: github.com/theYahia/qsearch
```

## Post-HN tweet (Tue 2026-05-05 16:00 UTC — ONLY if HN >40 points)

```
qsearch is on Hacker News — really useful comments coming in.

If you've fought with Tavily / Exa / Brave returning 200-char snippets
and your agent hallucinating: news.ycombinator.com/item?id=XXXXX

Apache 2.0, Docker, MCP-compatible.
```

If HN underperformed (<40 points): SKIP the post-HN tweet. Pivot Wednesday narrative to "I learned X from launching" — preserve narrative dignity.

## Schedule

- **Mon 2026-05-04 18:00–22:00 UTC** — Pre-launch teaser (above)
- **Tue 2026-05-05 14:00 UTC (07:00 PT)** — Show HN submit (NO tweet yet)
- **Tue 2026-05-05 16:00 UTC (09:00 PT)** — Post-HN tweet IF HN >40 points
- **Wed 2026-05-06 14:00 UTC** — Long-form blog post live on Hashnode/DEV.to (see `docs/blog/`)

## Long-form thread (alternative)

Full multi-tweet thread ready in `docs/launch-thread.md`.
