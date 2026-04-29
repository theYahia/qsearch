# qsearch v0.4.0 — Launch Calendar (2026-05-04 → 2026-05-07)

> Coordinated multi-channel launch driven by research synthesis in `research/distribution_channels.md`. All times UTC unless marked PT.
> Owner: Tim. Live URL: https://qsearch.pro. Repo: https://github.com/theYahia/qsearch.

## Pre-launch checklist

### 1 week before (by Mon 2026-04-28 EOD)
- [x] v0.4.0 tag pushed
- [x] qsearch.pro live (HTTP 200)
- [x] Hero docs (TRUST_MESH.md, FEDERATION_ARCHITECTURE.md, x402.md, VISION.md) shipped
- [ ] Update README badges: Apache-2.0, build status, Docker pulls, MCP-compatible
- [ ] Update qsearch.pro tagline (drop legacy QVAC SDK copy if any remain)
- [ ] Verify `test-mcp.js` runs cleanly + add 5-line README snippet showing Claude Desktop integration
- [ ] Add `CONTRIBUTING.md` with "Good First Issue" stub list (≥3 issues created)
- [ ] Pre-write 3 GitHub issues marked `good-first-issue` to seed contributor narrative

### 3 days before (Fri 2026-05-01 EOD)
- [ ] Test `mcp-publisher` CLI: `make publisher && ./bin/mcp-publisher --help`
- [ ] Draft `server.json` with namespace `io.github.theYahia/qsearch`
- [ ] Reduce launch-tweet.md to ≤280-char crispness
- [ ] Draft long-form blog post (DEV/Hashnode cross-post): "How qsearch's `engines[]` primitive cuts agent hallucination 17-33%" — title under 65 chars
- [ ] Practice first-comment template (see HN section below) — write 3 variants, pick crispest
- [ ] Verify GitHub repo is starrable / not under quota / no rate-limit issues

### 1 day before (Sun 2026-05-03)
- [x] **Published to MCP Registry** as io.github.theYahia/qsearch v0.4.0 on 2026-04-29 — verified live.
- [ ] ~~awesome-selfhosted PR~~ **BLOCKED until 2026-08-14** — list requires projects ≥4 months old (qsearch is 14 days). Draft saved at `docs/awesome-selfhosted-entry.yml` for later. PRs go to `awesome-selfhosted-data` repo (not README repo).
- [ ] Sleep cycle for Tuesday 14:00 UTC (07:00 PT) launch window

### 1 hour before (Tue 2026-05-05 13:00 UTC / 06:00 PT)
- [ ] Coffee. Check email for any unrelated notifications. Mute non-essential pings.
- [ ] Open: HN submit page, GitHub repo, Twitter draft tab, Reddit megathread tab, Slack/Discord tabs prepared.
- [ ] Verify qsearch.pro 200 OK (curl). Verify github.com/theYahia/qsearch reachable.
- [ ] Phone OFF Twitter notifications EXCEPT @ replies.

---

## Day 1 — Monday 2026-05-04 (soft launch)

### Morning (Tim local)
- **Action:** Find r/selfhosted weekly New Project Megathread (auto-posted Mondays, search subreddit for `New Project Megathread Week of 04 May 2026`).
- **Comment template:**
  ```
  App name: qsearch
  Description: Open-source search layer for AI agents. Multi-engine
  provenance — every URL annotated with which engines (Brave, DDG,
  Google, Startpage) actually agreed. Cuts agent hallucination by
  giving full pages instead of 200-char snippets.

  Repo: https://github.com/theYahia/qsearch
  Documentation: README + docs/ in repo, qsearch.pro for hosted demo
  Deployment: docker-compose up — 5 minutes to run locally, no API keys
  required (BYOK for upstream search engines if you have them)
  Screenshot: [embed pareto-chart.png]

  Apache-2.0. Built solo, feedback welcome especially on the
  engines[] primitive design.
  ```
- **Owner:** Tim. **Time:** any time Mon. **Channel:** Reddit r/selfhosted.

### Afternoon (Tim local)
- **Action:** Post to r/MachineLearning weekly `[D] Self-Promotion Thread`.
- **Comment template (shorter, ML-flavored):**
  ```
  qsearch — open-source search layer for AI agents.

  Built around one observation: agents reading 200-char SERP snippets
  hallucinate at production-measured rates of 17-33% (Stanford, 2024).
  qsearch fetches full content + tracks engines[] per URL — so when
  Brave + DDG + Google all return the same source, that's signal,
  not just one engine's SEO surface.

  Apache-2.0, Docker, MCP-compatible. Looking for criticism on the
  multi-engine consensus design. github.com/theYahia/qsearch
  ```
- **Owner:** Tim. **Channel:** Reddit r/MachineLearning.

### Evening UTC (Mon 18:00–22:00 UTC / 11:00–15:00 PT)
- **Action:** Twitter teaser thread. NO link to HN (HN doesn't exist yet). Frame as "shipping tomorrow."
- **Tweet template:**
  ```
  ⏳ Tomorrow I ship qsearch v0.4.0 — the open-source search layer for AI agents.

  Stanford measured production RAG agents hallucinate 17-33% of facts.
  My theory: it's because they read snippets, not pages.

  Built a fix. Apache 2.0. Tomorrow: github.com/theYahia/qsearch
  ```
- **Owner:** Tim. **Channel:** X / @theYahia. **Goal:** seed network so people see Tuesday's launch in feed.

---

## Day 2 — Tuesday 2026-05-05 (HN LAUNCH DAY)

### 13:30 UTC (06:30 PT) — Pre-flight (30 min before)
- [ ] Hydrate. Phone DND on except @ replies.
- [ ] Open tabs: HN submit / your post URL placeholder / Twitter draft / 3 close friends Slack DMs (warm them you're posting in 30 min — DO NOT ask for upvotes).

### **14:00 UTC (07:00 PT) — Show HN submission** ⭐ LOAD-BEARING

- **URL:** https://news.ycombinator.com/submit
- **Title (final):** `Show HN: qsearch – Open-source search layer for AI agents`
  - Length: 56 chars (under 55 char optimum). "Open Source" wording (+38% per 1,200-launch study). Avoids "AI-Powered" (-15%).
- **Submit URL:** https://github.com/theYahia/qsearch (NOT the homepage — repo first per HN dev-tool guide)

### 14:01 UTC (07:01 PT) — First comment (within 60 sec)

```
Author here. qsearch was built around one missing primitive in agent
search APIs: engines[] per URL — which engines actually agreed.

Stanford measured 17-33% fact hallucination in production RAG agents
because they read 200-char snippets instead of pages. So qsearch (a)
fetches full content, and (b) tracks which of {Brave, DDG, Google,
Startpage} actually surfaced each URL. URL found by 4 engines = real;
URL found by 1 = possible SEO trash.

Apache 2.0, BYOK, docker-compose up. MCP server included so Claude/
Cursor can use it directly.

Curious where this breaks for your agent use case — what's missing
from current search APIs (Tavily, Exa, Brave) that you've worked
around manually?
```

### 14:00–14:30 UTC — Critical first 30 min
- [ ] Reply to every comment within 10 minutes. Technical detail, no marketing.
- [ ] DO NOT tweet HN link yet.
- [ ] DO NOT ask anyone to upvote.
- [ ] Goal: ~8-10 organic upvotes + 2-3 thoughtful comments → top 30.

### 14:30–16:00 UTC — Hour 1-2
- [ ] Continue replying. If post is at >15 points and on /new still, you're tracking front-page. If <5 points after 30 min, post likely dying.
- [ ] **DO NOT delete and re-post.** Live with it.
- [ ] If shadow-flagged (visible to you, not in /new for incognito), email `hn@ycombinator.com` with one polite line:
  > "Hi dang, my Show HN at item=XXXXX appears to be flagged. I'm a solo dev launching an OSS dev tool, no marketing in the post. If misclassified, would appreciate a vouch or second-chance review. Thanks."

### 16:00 UTC (09:00 PT) — Twitter HN-link tweet (only if HN >40 points)
- **Template (only if landed):**
  ```
  qsearch is on Hacker News — really useful comments coming in.

  If you've fought with Tavily / Exa / Brave returning 200-char snippets
  and your agent hallucinating: news.ycombinator.com/item?id=XXXXX

  Apache 2.0, Docker, MCP-compatible.
  ```
- **If HN underperformed (<40 points):** SKIP this tweet. Pivot Wednesday narrative to "I learned X from launching" — preserve narrative dignity.

### Evening UTC — Steady state
- [ ] Reply to comments hourly until ~22:00 UTC. After that, pause until morning.
- [ ] Track GitHub stars hourly: GitHub > Insights > Traffic, or starhistory.com/theYahia/qsearch

---

## Day 3 — Wednesday 2026-05-06 (community amplification)

> Wednesday is the day to convert HN signal (or pivot from it) into community trust.

### Morning UTC
- **LangChain Slack** — single message to `#showcase` (or `#community-projects`):
  ```
  Built qsearch — Apache-2.0 open source search layer for agents.
  Multi-engine provenance (engines[] per URL), full-content fetch
  vs snippets, MCP-compatible. Yesterday's Show HN landed at X stars
  if useful: github.com/theYahia/qsearch

  Curious if anyone's hit the snippet-hallucination problem with
  LangChain agents — would love to learn from your workarounds.
  ```
  Reply with code snippets in THREAD only. Single posting, no bumps.
- **MCP Community Discord** (https://glama.ai/mcp/discord) — `#showcase` or `#projects`. Same message but lead with MCP angle: "built an MCP server that gives AI agents multi-engine search w/ provenance".
- **MLOps Community Slack** — `#share-your-work`. Message:
  ```
  qsearch — open source search infra for AI agents. Solves the
  snippet-hallucination problem we've all hit in prod RAG. Apache 2.0,
  Docker, BYOK. github.com/theYahia/qsearch — sharing because some of
  you might find the engines[] provenance design relevant for your
  guardrails / fact-check pipelines.
  ```

### Midday UTC
- **ChangeLog news submit:** https://changelog.com/news/submit
  - URL: https://github.com/theYahia/qsearch
  - Title: `qsearch: open source search layer for AI agents with multi-engine provenance`
  - What's interesting: 4-6 lines on the engines[] primitive + the Stanford 17-33% hallucination data; Apache 2.0; Docker; MCP. Mention HN landing if it did well.

### Afternoon UTC — Long-form blog post
- **Primary domain (Hashnode if owned, else qsearch.pro/blog):** Long-form (1500-2000 words) — title: `Why your agent hallucinates: the engines[] primitive missing from every search API`. Anchor on Stanford data, illustrate with code snippet showing qsearch usage, link 5-7 prior-art tools.
- **Cross-post:** dev.to + Hackernoon with `canonical_url` pointing back to primary. Tag: `#opensource #ai #rag #mcp #showdev` on dev.to.
- **Owner:** Tim. **Time:** Wed 14:00–18:00 UTC.

---

## Day 4 — Thursday 2026-05-07 (long-tail seeding)

### Morning UTC
- **r/SideProject post (after HN crosspost timing rules):**
  - Title: `qsearch — open source search layer for AI agents (just launched on HN)`
  - Body: link to github + 3-line value prop + Apache-2.0 emphasis. Crosspost is allowed.
- **r/learnmachinelearning Project Showcase Day:** comment in weekly thread (lower bar).

### Midday UTC
- **~~awesome-selfhosted PR:~~ BLOCKED until 2026-08-14** — list requires projects ≥4 months old (qsearch first commit 2026-04-14). Skip this channel for v0.4.0 launch. Resubmit August 2026 using `docs/awesome-selfhosted-entry.yml` as PR to `awesome-selfhosted-data` repo.
- **awesome-ai-agents PRs:** submit to slavakurilyak/awesome-ai-agents (active per Brave snippet) + Hannibal046/Awesome-LLM (active PRs through Nov 2025).

### Afternoon UTC
- **Fosstodon toot (or mastodon.social if not invited yet):**
  ```
  Just shipped qsearch v0.4.0 — open-source search layer for AI agents
  with multi-engine provenance.

  Apache 2.0. Docker. MCP-compatible. github.com/theYahia/qsearch

  Stanford measured 17-33% hallucination in prod RAG; my theory is
  agents read snippets not pages. Built a fix.

  #opensource #FOSS #selfhosted #MCP #LLM #AIagents
  ```

- **IndieHackers milestone post:** "Launched qsearch — week 1 numbers" (be honest about whatever metric came in; e.g., 280 stars / 25 forks / 8 contributors — if real). Format: short narrative + 3 lessons learned + ask for feedback. **Owner:** Tim. **Time:** Thu evening.

### Twitter outreach (low-priority, optional)
- Reply (NOT DM) to one of swyx, simonw recent threads where engines[] / multi-engine search is relevant. Add value to their conversation, not pitch. Examples (find via X):
  - swyx mentions "AI engineering search" → reply with engines[] primitive insight
  - simonw mentions LLM tool integration → reply with MCP-compatible angle

---

## Post-launch monitoring (Day 5+)

### Metrics to track daily for 7 days
| Metric | Tool | Target |
|--------|------|--------|
| GitHub stars | starhistory.com | >250 by Sun 2026-05-11 |
| HN front-page rank max | search HN by item ID | top 30 for ≥1 hour |
| HN comment count | item page | >25 |
| Twitter impressions | analytics.twitter.com | >5,000 cumulative |
| Reddit upvotes (sum across megathread + r/MachineLearning + r/SideProject) | manual | >100 cumulative |
| Slack/Discord reactions + DMs | manual | qualitative — log first 5 in research/launch_log.md |
| Newsletter pickups | inbox + manual search | ≥1 (ChangeLog or unsolicited) |
| New contributors (PRs from non-Tim) | GitHub | ≥1 within 14 days |

### Weekly retrospective (Sun 2026-05-11)
- [ ] Write `research/launch_retrospective.md` — what worked, what didn't, calibration vs research priors.
- [ ] Update `MEMORY.md` project entry on launch outcome.
- [ ] If <100 stars/week 1: revisit positioning (memory: `project_qsearch_trust_mesh_pivot.md`); maybe re-frame from "trust mesh" to specific killer-app angle.
- [ ] If >500 stars/week 1: pitch Latent Space / Practical AI as guest in 60 days.

---

## Hard rules (do NOT break)

1. **Never** ask for HN upvotes publicly (Twitter, LinkedIn, Telegram). Triggers shadow-ban per flowjam Nov-2025 guide.
2. **Never** create a fake account to comment/upvote your own post. Voting-ring detector triggers domain-wide shadow-ban.
3. **Never** post HN URL to a Reddit thread that wasn't already discussing your project. Looks like coordinated upvote rings.
4. **Never** delete and re-submit a poorly-performing HN post. HN allows ONE Show HN per project per ~6 months. Don't burn it.
5. **Never** edit out criticism from your post body. Engage with it in comments.
6. **Always** disclose authorship if any teammate or contractor is involved (r/LocalLLaMA bans "solo dev" posts that turn out to be company products — see `1oclug7` discussion).
7. **Always** keep MCP Registry namespace consistent (`io.github.theYahia/qsearch`) so cross-references resolve.

---

## Owner contact / escalation

- Primary: Tim (theYahia) — launch driver, all channels above
- Escalation if shadow-banned: hn@ycombinator.com (Dan Gackle)
- Backup if Tim unavailable hours 14:00-22:00 UTC Tue: post a Slack/Discord update only ("author traveling, will reply tonight"); do NOT delegate first-comments to teammates.
