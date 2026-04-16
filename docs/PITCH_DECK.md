# qsearch — 6-Slide Pitch Deck

*For Tether conversation 2026-04-21. Visual script — convert to slides in Canva/Keynote.*

---

## Slide 1 — Title

**qsearch**
*The open-web hop for QVAC agents*

`github.com/theYahia/qsearch` · Apache-2.0 · v0.1.0 · Built in 7 days

---

## Slide 2 — The gap

**The Tether edge stack has one missing layer.**

```
QVAC agent
  ├── local documents      ← QVAC Workbench  ✅
  ├── local wallet         ← WDK             ✅
  ├── local inference      ← @qvac/sdk       ✅
  └── live web             ← ???             ❌
```

> Every search API available today does the same thing:
> your query → their server → their LLM → their answer back.
>
> An agent that keeps your health data local but sends your search queries
> to a cloud API is **half-sovereign**. The architecture doesn't hold end-to-end.

---

## Slide 3 — The solution

**Two hops. One of them is yours.**

```
Your agent
  → POST /search { "query": "...", "n_results": 3 }

Hop 1 (outbound):   Brave Search API
                    BYOK — your key, your quota
                    brave_ms: 819ms

Hop 2 (local):      @qvac/sdk — Qwen3-0.6B Q4
                    364MB, cached on your machine
                    clean_ms: 1420ms
```

**The green node** — cleaning runs on your hardware.
Not a privacy-policy promise. Verifiable in 15 lines of code.

---

## Slide 4 — Real output (Day 3 terminal)

```json
{
  "query": "qvac sdk",
  "model": "QWEN3_600M_INST_Q4",
  "brave_ms": 819,
  "results": [
    {
      "url": "https://qvac.tether.io/",
      "title": "QVAC - Decentralized, Local AI in a Single API",
      "cleaned_markdown": "QVAC is a decentralized, local AI platform built
        on Tether, offering a new paradigm where intelligence runs privately,
        locally, and without permission on any device.",
      "clean_ms": 1420
    }
  ]
}
```

`npm install && npm start` — works on Windows/macOS/Linux.

---

## Slide 5 — Why qsearch vs Exa/Tavily

|  | Exa | Tavily | **qsearch** |
|--|-----|--------|-------------|
| LLM cleaning | ✅ cloud | ✅ cloud | ✅ **local** |
| OSS auditable | ❌ | ❌ | ✅ |
| QVAC-native | ❌ | ❌ | ✅ |
| Self-hostable | ❌ | ❌ | ✅ |
| BYOK upstream | ❌ | ❌ | ✅ |

> qsearch doesn't beat them on snippet quality.
> It wins when the *architecture* of where cleaning runs matters.

---

## Slide 6 — The ask

**7 days. No insider access. Full pipeline shipped.**

- Apache-2.0 — same license as QVAC, zero-friction to upstream
- WDK repost on day zero, public accountability contract held
- PRD anchored to Tether's verbatim TPM KPI language
- Workbench integration doc (MCP sidecar pattern) already written

> "Give me insider access and I ship 10x faster on things that actually matter to you."

`github.com/theYahia/qsearch` · `@TheTieTieTies`

---

## Speaker notes (not on slides)

**Slide 2** — Don't explain the half-sovereign problem at length. Say "half-sovereign" once and let it land. If they nod, move on. If they ask — then expand.

**Slide 3** — The `brave_ms` / `clean_ms` split is the proof. It shows you understand where each millisecond lives. Don't skip past it.

**Slide 4** — If there's a screen in the room, show the actual terminal or GitHub README. Live demo > slides.

**Slide 5** — Lead with "we're not competing with Exa — this wins on a different dimension." Prevents the "but Exa is better" deflection.

**Slide 6** — The ask is a one-liner. Say it, stop talking. Don't soften it.
