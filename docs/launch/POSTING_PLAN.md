# qsearch — Posting Plan (evergreen)

> Where, in what order, and at what time to announce qsearch v0.4.0. **No absolute dates** — sequenced by day-of-week and audience-hour so it stays usable whenever you pull the trigger. Drafts live in this folder; this file is the launch runbook around them.
>
> Supersedes the dated `docs/launch-calendar.md` (a fixed May-2026 calendar). The hard rules at the bottom are carried over from it — those don't expire.
>
> **Do not post anything from this plan automatically.** Every step below is a human action.

## Drafts this plan sequences

| Channel | Draft | Status |
|---|---|---|
| Hacker News (Show HN) | `POST_HN.md` | ready |
| dev.to article | `POST_devto.md` | ready |
| r/LocalLLaMA / r/LocalLLM | `POST_reddit_LocalLLaMA.md` | ready |
| Comparison long-form (dev.to/blog) | `comparison-post.md` | ready (has competitor [GAP]s — resolve before posting) |
| awesome-mcp-servers PR | `awesome-mcp-PR.md` | ready |
| awesome-selfhosted PR | `awesome-selfhosted-entry.yml` | gated by list's age rule (see below) |
| X / launch thread + tweet | `launch-thread.md`, `launch-tweet.md` | drafts exist |

## Pre-reqs (clear these BEFORE day 1 — they gate everything)

**Hacker News**
- Post from an aged account with real karma. Brand-new / zero-karma accounts get Show HNs auto-buried. If your main account is thin, build karma with genuine comments first; do not create a throwaway.
- One Show HN per project per ~6 months — you get one shot. Don't burn it on an off day.
- Repo `git clone` → `docker compose up -d` → `npm install && npm start` must be clean on a fresh checkout. `qsearch.pro` must return 200. Ollama judge (or `DEEPSEEK_API_KEY`) running so a live `/verify` demo isn't `Error`.
- **Smoke-test before posting** (proves the two angles you're announcing actually answer, on the fresh checkout):

  ```bash
  curl -sI https://qsearch.pro | head -1                         # expect: HTTP/.. 200
  curl -s http://localhost:8080/health | grep -o '"status":"[a-z]*"'  # expect: "status":"ok"
  # engines[] angle — expect a count=N line in parsed_snippets.md:
  curl -s -X POST http://localhost:8080/sweep -H "Content-Type: text/plain" \
    --data-binary $'t1|self-hosted search engine\n' >/dev/null && echo sweep-ok
  # /verify angle — expect verdict Supported/Partial/Unsupported, NOT Error:
  curl -s -X POST http://localhost:8080/verify -H "Content-Type: application/json" \
    -d '{"claim":"Qdrant is written in Rust.","url":"https://github.com/qdrant/qdrant"}' \
    | grep -o '"verdict": *"[A-Za-z]*"'
  ```

  If the last line prints `"verdict":"Error"`, the judge isn't reachable — `ollama pull qwen2.5:14b-instruct` and confirm Ollama is up (or set `DEEPSEEK_API_KEY`) before you post. A live demo returning `Error` is the worst possible first impression on HN.

**Reddit (r/LocalLLaMA, r/LocalLLM, r/selfhosted, r/MachineLearning)**
- Account age + comment karma matter — most ML/self-host subs filter young or low-karma accounts, some auto-remove. Use an account that has actually participated.
- Read each sub's self-promo rule. Several require a `Project`/`Resources` flair or restrict promo to a weekly megathread. Disclose solo-dev in line 1 (r/LocalLLaMA has removed posts where "solo dev" was actually a company).
- One organic top-level post per sub. No cross-sub copy-paste within the same hour (looks coordinated).

**dev.to**
- Profile filled in (bio, avatar, GitHub link) — bare profiles read as drive-by spam.
- Use `canonical_url` if you cross-post the same article elsewhere, to protect SEO.

**X / Mastodon**
- Teaser can pre-seed the network. Never link the HN item before it's landed (and never ask for upvotes — see hard rules).

## Sequence (day-of-week + audience-hour)

> Timezone anchor: **HN and US dev Reddit peak = US-morning, roughly 13:00–15:00 UTC (≈06:00–08:00 US Pacific).** Best launch days are **Tuesday–Thursday**; avoid Friday/weekend for HN (lower front-page throughput) and avoid Monday (inbox-clearing noise).

**Day 0 (evening before, any day) — warm-up, no links**
- X/Mastodon teaser: "shipping qsearch tomorrow" framing. Pre-seeds feed. No HN link (doesn't exist yet).
- Final dry run of the 5-minute clone path + `qsearch.pro` 200 check.

**Day 1 (Tue or Wed) — Show HN, the load-bearing slot**
- Submit `POST_HN.md` at the US-morning window (≈13:00–15:00 UTC / 06:00–08:00 PT). Repo URL, not homepage.
- Paste the first comment within 60 seconds.
- Next 2 hours: reply to every comment within ~10 min, technical, no marketing. Do **not** tweet the HN link yet. Do **not** ask for upvotes.
- Only if it lands well (say, front-page / strong score): a single X post pointing to the discussion. If it underperforms, skip the link tweet and keep narrative dignity — no delete-and-repost.

**Day 2 (Wed or Thu) — community amplification**
- r/LocalLLaMA (or r/LocalLLM): post `POST_reddit_LocalLLaMA.md` in the US-morning-to-midday window. Lead with the local-model judge angle. Reply with code in threads only; one post, no bumps.
- dev.to: publish `POST_devto.md` (tags `#ai #opensource #llm #search`). Mid-week, US morning. If you also run `comparison-post.md`, set its `canonical_url` to one primary copy.
- Niche Slack/Discord (MCP community, LangChain `#showcase`, MLOps `#share-your-work`): one message each, MCP angle for the MCP server, no bumps. Disclose authorship.

**Day 3 (Thu/Fri) — long-tail seeding**
- r/selfhosted weekly "New Project" megathread (auto-posted Mondays in that sub — drop into the current week's thread). r/SideProject standalone post is allowed as a crosspost.
- ChangeLog news submit (`changelog.com/news/submit`) — repo URL + 4–6 lines on `engines[]` + `/verify`.
- Fosstodon/Mastodon toot with `#opensource #FOSS #selfhosted #MCP #LLM` tags.

## Awesome-list PR targets

| List | Repo | Section | Gate | Draft |
|---|---|---|---|---|
| awesome-mcp-servers | `punkpeye/awesome-mcp-servers` | 🔎 Search & Data Extraction | No age rule. Ready now. Insert alphabetically among `t…` (verify neighbors at edit time). | `awesome-mcp-PR.md` |
| awesome-selfhosted | `awesome-selfhosted/awesome-selfhosted-data` | Search | **Projects must be ≥4 months old.** qsearch first commit is mid-Apr 2026 → eligible from ~mid-Aug 2026. PR goes to the `-data` repo, not the README repo. | `awesome-selfhosted-entry.yml` |
| awesome-ai-agents | `slavakurilyak/awesome-ai-agents` | search/retrieval tooling | No published age rule. Verify it's still maintained before opening. | — (compose from README one-liner) |
| Awesome-LLM | `Hannibal046/Awesome-LLM` | tools | Verify maintenance/PR cadence before opening. | — |

Open each as a separate PR (most lists want one entry per PR). Re-confirm the repo + `qsearch.pro` are reachable right before submitting.

## "Post it in one sitting" checklist

Clears in ~30–45 min if pre-reqs are already green. Run top to bottom:

- [ ] Pre-reqs above are all green — run the **Smoke-test block** in HN pre-reqs (`qsearch.pro` 200, `/health` ok, `/sweep` count line, `/verify` returns a non-`Error` verdict), aged accounts ready.
- [ ] It's a Tue/Wed/Thu, US-morning window (~13:00–15:00 UTC).
- [ ] Open tabs: HN submit · GitHub repo · X draft · target Reddit sub · dev.to editor.
- [ ] Phone DND except @-replies. No upvote asks queued anywhere.
- [ ] **HN:** paste title + repo URL from `POST_HN.md` → submit → paste first comment within 60s.
- [ ] Set a 2-hour reply watch on the HN thread (every comment, ~10 min, technical).
- [ ] **Reddit:** paste `POST_reddit_LocalLLaMA.md`, correct flair, solo-dev disclosure line 1.
- [ ] **dev.to:** paste `POST_devto.md`, tags set, `canonical_url` if cross-posting.
- [ ] **awesome-mcp-servers:** fork → add line alphabetically in 🔎 Search & Data Extraction → open PR (`awesome-mcp-PR.md`).
- [ ] X teaser/landing tweet per the day-1 rule (link only if HN landed).
- [ ] Log first outcomes (stars, comments, verdicts of any /verify questions) for the retro.

## Hard rules (do NOT break — carried from launch-calendar.md)

1. **Never** ask for HN upvotes publicly (X/LinkedIn/Telegram) — triggers shadow-ban.
2. **Never** create fake accounts to upvote/comment your own post — voting-ring detection = domain-wide shadow-ban.
3. **Never** drop the HN URL into a Reddit thread that wasn't already discussing the project — looks like a coordinated ring.
4. **Never** delete and re-submit a weak HN post — one Show HN per project per ~6 months.
5. **Never** edit criticism out of the post body — engage with it in comments.
6. **Always** disclose authorship / any non-solo involvement (esp. r/LocalLLaMA).
7. **Always** keep the MCP Registry namespace consistent (`io.github.theYahia/qsearch`).

## What this plan does NOT cover (resolve separately)

- Competitor pricing/feature `[GAP]`s in `comparison-post.md` — verify before that post goes out.
- Exact alphabetical neighbors in the awesome-mcp-servers Search section — confirm at edit time.
- VRAM figure for the local judge — not asserted in the repo; state what you actually run, don't guess.
