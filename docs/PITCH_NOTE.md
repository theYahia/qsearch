# qsearch — Pitch Note

*For Tether conversation 2026-04-21. Internal, not published.*

---

## One-line

> I spent 48 hours building on QVAC with no insider access. Here's what shipped.

---

## What shipped (Apr 14-15, all ahead of schedule)

| Artifact | Details |
|----------|---------|
| Working search API | `npm install && npm start` → `POST /search` with Brave + QVAC local cleaning |
| v0.1.0 tagged release | 21 commits, tested on Windows 11 x64 |
| Blog post | "Why cleaning needs to run on your hardware, not ours" — real code, real numbers |
| PRD | Anchored to Tether's verbatim TPM KPI categories |
| Workbench integration doc | MCP tool schema + sidecar pattern — ready to slot into Integrations tab |
| Apache-2.0 license | Same as QVAC — zero-friction to upstream |
| Public roadmap | Committed in the WDK-reposted thread, held on schedule |
| WDK_tether repost | Day zero, before any code — public accountability |

**Stack:** Node.js ≥20, @qvac/sdk 0.8.3, Qwen3-0.6B Q4 (364MB), Brave Data-for-AI tier.
**Benchmarks:** brave_ms ~800ms, clean_ms ~1.1s per result (laptop CPU).

---

## The architecture argument (30 seconds)

Tether shipped QVAC (Apr 9) and WDK (Apr 13). The stack: local inference + local documents + self-custodial wallet. What's missing: the live web.

Every search API today sends the query to their server → their LLM cleans it → their server answers. An agent running on QVAC with local health data is *half-sovereign* the moment it calls Exa.

qsearch: Brave fetch (BYOK, one outbound hop) + @qvac/sdk local cleaning (your CPU, zero outbound). `brave_ms` is their latency. `clean_ms` is yours. Verifiable in `src/server.js` — 120 lines.

---

## Why these decisions (taste signals)

**Apache-2.0** — same license as QVAC. Anything in qsearch is zero-friction to upstream into Tether repos if it ever makes sense. Checked their license before picking.

**Brave, not Exa/Tavily** — independent index (not Google/Bing wrapper), Data-for-AI tier with explicit AI-transformation ToS, BYOK. Architecture holds end-to-end.

**Local cleaning, not cloud** — the wedge. An agent running QVAC with health data local but search queries going to Exa is architecturally incoherent. qsearch makes the cleaning step run on user hardware. Auditable in code, not a privacy policy.

**No hosted tier, no UI, no auth** — deliberate scope cut. Three differentiators are architectural. Everything else is v2 after validating what's useful.

**Sequential inference** — correct for v0.1. Concurrent model access creates race conditions in bare worker. Documented in blog. Parallel is v0.2 optimization.

**`/no_think` + regex strip** — Qwen3 has built-in chain-of-thought. For search cleaning, direct output > reasoning. Found this by running the pipeline, not reading docs.

---

## The ask

> A seat at the edge-stack table. I've spent a week building on QVAC with no insider access — give me insider access and I ship 10x faster on things that actually matter to you.

---

## Build-in-public proof

- WDK_tether repost on day zero (before any code existed)
- Full pipeline shipped in 48 hours, 4 days ahead of schedule
- 21 commits, each timestamped — verifiable with `git log`
- Honest trade-offs in README and blog — no aspirational claims
- `git clone && npm install && npm start` works, tested

---

## If asked about gaps

**"Snippet quality?"** — acknowledged in README and blog. 600M model can't out-clean a datacenter GPU. That's not the claim. The claim is architecture, not ranking. Upgrade path: swap one constant → QWEN3_1_7B (1008MB).

**"Brave dependency?"** — one external hop is unavoidable for live web. Brave is the best fit for the thesis. SearXNG self-hosted is v0.2 — no API key, runs on your own index.

**"Why so small?"** — because every feature I don't ship is a feature I can't be wrong about. The differentiators are architectural. Everything else is v2 after I know what's useful.

**"Cold start?"** — model loads once at server start, inference is warm from there. Run as daemon, not lambda.

**"Only tested on Windows?"** — macOS/Linux work via Node.js + npm. Bare worker is cross-platform. Windows 11 x64 personally tested.

---

## Delivery rules

- One prepared phrase per topic change, max. Don't cascade.
- Let them open the door, then walk through it.
- If they use different vocabulary, mirror theirs first.
- Silence is fine. Not every question needs a polished answer.

---

*Pitch phrases reference: Claude memory `project_pitch_phrases.md`. This note is not public.*
