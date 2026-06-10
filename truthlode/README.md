# Truthlode — the citation-honesty record

**We fetched all 273 sources cited by two frontier AI deep-research agents on three legal
questions. Of the 199 we could read, 1 in 5 did not fully support the claim it was cited
for — and every verdict comes with the receipt.**

Live board: **[truthlode.org](https://truthlode.org)** · every number on it opens its
exhibit: claim, source excerpt, the judge's evidence quote, a link to the original.

[![truthlode](https://img.shields.io/endpoint?url=https%3A%2F%2Ftruthlode.org%2Fbadge.json)](https://truthlode.org)

## The board (legal v1 — non-compete, qualified immunity, fair use)

| Agent | Cites | Checkable | Fabricated | Unsupported | Supported (of all cites) |
|---|--:|--:|--:|--:|--:|
| **Gemini 3.1 Pro Deep Research** | 154 | 113 | **0.0%** | 13.0% | 57.1% |
| **Claude Deep Research** | 119 | 86 | **1.7%** | 7.6% | 60.5% |
| _ChatGPT Deep Research_ | — | — | _docketed_ | — | — |
| _Perplexity Deep Research_ | — | — | _docketed_ | — | — |
| _Exa Research_ | — | — | _docketed_ | — | — |
| _Parallel Search API_ | — | — | _docketed_ | — | — |

Primary metrics are computed **over all cited URLs**, not just the readable ones — an agent
can't inflate its score by citing sources behind paywalls or bot-walls. The unreadable share
(~27%, mostly Cloudflare-walled legal sites) is shown as a coverage gap, scored neither way,
with the blocked-domain list published on the Method tab.

The most surprising v1 finding favors the agents: fabricated URLs are nearly extinct
(Gemini 0 of 154, Claude 2 of 119). The live failure mode is subtler — the URL is real, but
the source doesn't fully say what the agent claims.

## How a verdict is entered

For each `(claim, cited_url)` an agent produced:

1. **Fabricated check — mechanical, unchallengeable.** Fetch the URL. 404 / dead domain /
   not a real page → `Fabricated`. No judgment call. Reachable but unreadable → coverage gap.
2. **Support check — auditable judge.** Extract the source, deterministically rank the
   passages that touch the claim's specifics (same input → same passages), judge support →
   `Supported` / `Partial` / `Unsupported`. The source excerpt and the judge's evidence quote
   are filed beside every verdict.

Conservative by design: if support isn't explicit, the verdict is `Unsupported`.
Plausibility is not support.

**The judge is the least-trusted component, so it's built to need no trust.** It agrees with
human labels **87.3%** (Cohen's κ=0.75 binary; 83.6% / κ=0.737 exact four-way) on a
hand-labeled gold set — the published CiteGuard baseline is 68%. Every judge↔human
disagreement is conservative (the judge under-credits, never over-credits) and listed in the
open on the Method tab. And because every verdict ships its receipt, you don't have to trust
the judge at all: re-check any row by hand.

## Why legal first

Courts keep catching AI-fabricated and mis-cited authorities — a public
[case database](https://www.damiencharlotin.com/hallucinations/) tracks the sanctions wave,
and Florida's fabricated-citation rule (effective June 15, 2026) puts every AI-handed
citation under the attorney's own certification. Case law is public, so ground truth is
clean. Breadth comes after the method survives scrutiny.

## Reproduce it

```bash
node bench/harness.js <submissions.json> [outdir]
```

Outputs `leaderboard.md` + `audit.json` (every verdict + source excerpt). Judge: local
Ollama (`qwen2.5:14b-instruct`) or DeepSeek (`DEEPSEEK_API_KEY` in `.env.local`), temperature
0, model recorded per run. The verdict cache is committed — a re-run returns the published
figures exactly.

Build the site data from the audit:

```bash
node site/build_site.mjs   # data.json + truthlode.csv + badge.json + og.html, injects the headline into index.html
```

## Disagree with a verdict?

The receipt is the appeal form. Open the row, read the source excerpt, and
[challenge the verdict](../../issues/new?template=verdict-challenge.yml) — every dispute is
public, every resolution is logged. To nominate the next agent for the docket, vote on the
[request-an-agent issue](../../issues).

## Data

- [`site/data.json`](site/data.json) — full board + receipts (rebuilt from `bench/out/all/audit.json`)
- [`site/truthlode.csv`](site/truthlode.csv) — flat per-agent metrics
- `bench/gold/labels.json` — the hand-labeled gold set, published next to its receipts

## Cite this

```bibtex
@misc{truthlode2026,
  title  = {Truthlode: a citation-honesty audit of AI deep-research agents},
  author = {{Truthlode maintainers}},
  year   = {2026},
  url    = {https://truthlode.org},
  note   = {Legal vertical v1. Code MIT, data CC-BY-4.0, committed verdict cache.}
}
```

## Neutrality

No money from the agents on this record, ever. No badge fees, no sponsored re-runs. The
maintainer's own tools are not on the board. Code **MIT**, data **CC-BY-4.0** — re-run, same
verdicts.
