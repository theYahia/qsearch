# qsearch — Pitch Note

*For Tether conversation 2026-04-21. Internal, not published.*

---

## One-line

> I spent a week building on QVAC with no insider access. Here's what shipped.

---

## What shipped in 7 days

| Artifact | Link |
|----------|------|
| Working search API, `npm install && npm start` | github.com/theYahia/qsearch |
| v0.1.0 tagged release | GitHub Releases |
| Blog: "Why cleaning needs to run on your hardware, not ours" | [BLOG.md](../BLOG.md) |
| PRD anchored to Tether's TPM KPI language | [docs/PRD.md](PRD.md) |
| Workbench integration doc (MCP tool schema + sidecar pattern) | [docs/WORKBENCH_INTEGRATION.md](WORKBENCH_INTEGRATION.md) |
| Apache-2.0 (same license as QVAC) | LICENSE |
| Public roadmap, committed to WDK-reposted thread | [ROADMAP.md](../ROADMAP.md) |
| WDK_tether repost on day zero | x.com/WDK_tether (2026-04-14) |

---

## Why these decisions were made

**Apache-2.0 license** — same as QVAC itself. Any code in qsearch is zero-friction to upstream into Tether repos if it ever makes sense. Checked the license before picking one.

**Brave, not Exa/Tavily** — three reasons: independent index (not a Google/Bing wrapper), Data-for-AI tier with explicit AI-transformation ToS permission, BYOK so the user's key and quota never pass through qsearch infrastructure. Architecture holds end-to-end.

**Local LLM cleaning, not cloud** — the positioning wedge. An agent running on QVAC with health data local but search queries going to Exa is architecturally incoherent. qsearch makes the cleaning step run on the user's hardware. Auditable in code, not a privacy policy.

**No hosted tier, no UI, no auth** — deliberate scope cut. The three differentiators (local cleaning / OSS core / agent primitive) are architectural. Everything else is v2 after validating what's actually useful.

**Sequential inference, not parallel** — correct call for v0.1. Concurrent inference on a single loaded model creates race conditions in the bare worker. Documented in the blog post. Parallel is a v0.2 optimization.

**`/no_think` + regex strip** — Qwen3-0.6B has a built-in chain-of-thought mode. For a search cleaner, direct output is better than reasoning. The directive suppresses it; the regex is belt-and-suspenders. Both required: found this by running the pipeline.

---

## The architecture argument (30 seconds)

Tether shipped QVAC (Apr 9) and WDK (Apr 13). The stack is: local inference + local documents + self-custodial wallet. What's missing: the live web.

Every search API today sends the query to their server. Their server cleans. Their server answers. An agent running on QVAC with local health data is *half-sovereign* the moment it calls Exa. The architecture doesn't hold end-to-end.

qsearch: Brave fetch (BYOK, one outbound hop) + @qvac/sdk local cleaning (your CPU, zero outbound). `brave_ms` is their latency. `clean_ms` is yours. Verifiable in 15 lines of code.

---

## The ask

A seat at the edge-stack table. I've spent a week building on QVAC with no insider access — give me insider access and I ship 10x faster on things that actually matter to you.

---

## Build-in-public proof

- Public commitment reposted by `@WDK_tether` on day zero (before any code)
- 5 public deliverables shipped in 7 days, all ahead of schedule
- Honest trade-offs in the README and blog — no aspirational claims, no hidden failures
- Every commit timestamped, pipeline verifiable with `git clone && npm install && npm start`

---

## If asked about gaps

**Snippet quality** — acknowledged in the README and blog. A 600M model can't out-clean a datacenter GPU. That's not the claim. The claim is architecture, not ranking.

**Brave dependency** — one external hop is unavoidable for live web. Brave is the best fit for the thesis. SearXNG self-hosted is v0.2 — no API key required, runs on your own index.

**Cold start** — model loads once, inference is warm from there. Run as a daemon, not a lambda. Documented.

**Windows only (tested)** — macOS/Linux work via Node.js + npm; bare worker is cross-platform. Windows 11 x64 tested personally.

---

*This note is not public. Pitch phrases (delivery rules, taste signals): see Claude memory `project_pitch_phrases.md`.*
