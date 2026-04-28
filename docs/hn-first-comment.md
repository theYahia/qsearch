# Show HN first-comment templates

> First-comment within 60 sec of submission is load-bearing per Phase F research.
> Pick crispest variant Tuesday 2026-05-05 14:00 UTC -1 minute.
> Practice copy-paste flow Monday evening.

## Variant 1 — primitive + invitation

```
Author here. qsearch built around one missing primitive: engines[] per URL — which engines actually agreed.

Stanford measured 17-33% fact hallucination in production RAG (Lexis+ AI, Westlaw) because they read 200-char snippets. So qsearch fetches full pages + tracks {Brave, DDG, Google, Startpage} attribution. URL found by 4 engines = real; found by 1 = possible SEO trash.

Apache 2.0, BYOK, docker-compose up. MCP server included for Claude/Cursor.

Curious where this breaks for your agent use case — what's missing from current search APIs (Tavily, Exa) you've worked around?
```

**When to use:** standard playbook. Opens with the primitive, justifies with data, ends with invitation. Highest expected upvote ratio for HN technical crowd.

## Variant 2 — story-first

```
Author here. After running 100+ research sprints with my AI agent and watching it hallucinate facts that weren't in the search snippets it read, I got tired of it.

qsearch is what I built: full content (not snippets) + multi-engine provenance (engines[] per URL). Apache 2.0, MCP-compatible.

The trust signal: URL found by Google + DDG + Brave + Qwant = probably real. Found by 1 obscure engine = SEO trash. Built into the data, not bolted on.

Self-hosted, BYOK if you want Brave Search. github.com/theYahia/qsearch
```

**When to use:** if HN crowd seems story-receptive (some recent Show HN landings have favored "I built this for myself" framing). Lower technical density, higher relatability.

## Variant 3 — short and direct

```
Author here. TL;DR: open-source search API that gives agents full pages instead of 200-char snippets, plus engines[] per URL showing which search engines agreed.

Multi-engine consensus = trust signal. Apache 2.0, BYOK, docker-compose up.

Where does this break for your agent? Looking for hard cases.
```

**When to use:** if I miss the 60-sec window and need to drop something fast. Minimal viable comment.

## Hard rules (per `docs/launch-calendar.md`)

1. **NO marketing** — technical detail only. HN flags promo-flavored Show HN posts.
2. **Reply to every comment within 10 minutes** for first 30 minutes.
3. **DO NOT delete and re-post** the HN submission if it underperforms.
4. **DO NOT ask for upvotes** anywhere (Twitter, Reddit, Slack, Discord, friends DMs).
5. **If shadow-flagged:** email `hn@ycombinator.com` ONE polite line per launch-calendar line ~136.

## Practice flow (Mon 2026-05-04 evening)

1. Open `docs/hn-first-comment.md` → copy Variant 1 to clipboard
2. Open `https://news.ycombinator.com/submit` in tab 2
3. Open `docs/launch-calendar.md` line 105 (HN submit title) in tab 3
4. Time yourself: paste title → submit → tab to comment box → paste comment → submit
5. Target: ≤45 seconds from submit-click to comment-submit
