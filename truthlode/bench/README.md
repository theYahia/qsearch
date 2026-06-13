# Truthlode Bench

**A neutral, reproducible benchmark for citation honesty in AI deep-research agents.**

Deep-research tools (Perplexity, ChatGPT, Gemini Deep Research, Exa…) answer with citations — but a large share of those citations don't actually support the claim, or point to sources that don't exist. Measured citation-error rates range from **11% to 95%** across models (GhostCite, "Cited but Not Verified", CJR). Yet every vendor reports only the numbers that flatter it, and no public scoreboard answers the one question that matters for a high-stakes decision:

> **When this tool cites a source, does the source actually say what the tool claims?**

Truthlode Bench measures exactly that, mechanically and auditably, and ranks the tools.

## How it works

For each `(claim, cited_url)` an agent produces:

1. **Fabricated check (mechanical, unchallengeable).** Fetch the cited URL. If it 404s, fails DNS, or isn't a real page → `Fabricated`. No judgment call.
2. **Support check (LLM-as-judge, auditable).** Fetch + extract the source, deterministically select the most relevant passages (lexical ranking — same input, same passages), and judge whether they support the claim → `Supported` / `Partial` / `Unsupported`. The exact source excerpt and the judge's evidence quote are saved next to every verdict, so **anyone can re-check by hand.**

Conservative by design: if support isn't explicitly present, the verdict is `Unsupported`. Plausibility is not support.

## Why you can trust the benchmark (anti-gaming)

- **Open data + open code + committed verdict cache** → re-runs reproduce the published numbers exactly (the cache pins each verdict; the judge model is recorded per run, since hosted aliases like `deepseek-chat` can drift).
- **`Fabricated` is mechanical**, not a model opinion — a dead/invented citation cannot be argued away.
- **Primary metrics are over ALL cited URLs** (Fabricated, Unsupported), with fetch **Coverage** shown — so an agent can't inflate its score by citing bot-blocked / paywalled sources (those don't vanish into a hidden Error bucket).
- **Judge↔human agreement is reported with Cohen's κ** (not just raw %), so the credibility number isn't inflated by class imbalance.
- **Every verdict ships its source excerpt** in `audit.json` — disagree? Open it and check.

## Focus: legal research (v1)

Legal is where citation honesty is already a public, high-stakes crisis: **1,200+ documented court cases (2025–2026)** of lawyers sanctioned for AI-fabricated citations (Oregon $109,700; Florida's fabricated-citation rule (Rule 2.515(d)(2)) effective June 15, 2026; new cases weekly). Case law is fully public, so ground truth is clean. v1 scores deep-research agents on real legal-research questions. (Medical and finance verticals to follow.)

## Run it

```bash
node truthlode/bench/harness.js <submissions.json> [outdir]
```

`submissions.json`:
```json
[{ "agent": "Perplexity Deep Research",
   "citations": [ { "claim": "…", "url": "https://…" } ] }]
```

Output: `leaderboard.md` + `audit.json` (every verdict + source excerpt).

Judge: local Ollama (`qwen2.5:14b-instruct`, $0) by default, or DeepSeek (`TRUTHLODE_JUDGE_PROVIDER=deepseek`) — the judge label is recorded per run. Built on the [qsearch](../../) verification substrate (SSRF-guarded fetch + Crawl4AI headless fallback + main-content extraction, via `fetch_content.js`).

## Leaderboard

_v1, 3 legal topics. Primary metrics over ALL cited URLs (lower Fabricated / Unsupported = better); Coverage = share we could fetch + judge; Support %¹ = Supported/fetched (secondary, coverage-dependent). Ranked by Fabricated, then Unsupported._

| Agent | Cites | Coverage | ✓ Supported | ✗ Unsupported | ☠ Fabricated | Support %¹ |
|---|--:|--:|--:|--:|--:|--:|
| Gemini 3.1 Pro Deep Research | 154 | 73.4% | 57.1% | 13.0% | 0.0% | 77.9% |
| Claude Deep Research | 119 | 72.3% | 60.5% | 7.6% | 1.7% | 83.7% |
| _Perplexity Deep Research_ | — | — | — | — | — | — |
| _ChatGPT Deep Research_ | — | — | — | — | — | — |

Judge↔human agreement on a 55-citation gold set: **87.3% binary (κ=0.750), 83.6% exact 4-way (κ=0.737)** — κ corrects for chance; >0.6 is substantial.

## Method anchors

CiteGuard (arXiv:2510.17853), FACTS Grounding (Google DeepMind), NLI entailment (FEVER), DeepResearch Bench. Legal-citation existence resolved against CourtListener / Free Law Project (roadmap).

Related citation-quality benchmarks: [DRACO](https://research.perplexity.ai/articles/evaluating-deep-research-performance-in-the-wild-with-the-draco-benchmark) (Perplexity) and [DeepResearch Bench](https://deepresearch-bench.github.io/) score citation accuracy across general domains; [Rao, Wong & Callison-Burch](https://arxiv.org/abs/2604.03173) measure fabricated-URL rates at scale; [LegalCiteBench](https://arxiv.org/abs/2605.10186) probes legal-citation recall. Truthlode differs by being neutral (no vendor money, maintainer's tools off the board), publishing a per-citation receipt for every verdict, judging *support* rather than mere URL existence, and using public case law as live ground truth.

## License

Code: MIT. Question sets: CC-BY-4.0. Built by an independent researcher — a neutral referee, by design (a frontier lab can't run a leaderboard its own model competes on).
