# qsearch — Outreach Templates

*Pitch day backup scenarios. Use only if the April 21 conversation doesn't happen as planned.*

---

## Scenario A — Already scheduled ✅

The 2026-04-21 Tether conversation is confirmed. No outreach needed. This document is the fallback.

---

## Scenario B — Cold outreach (if conversation falls through)

Target: Paolo Ardoino (`@paoloardoino`) or Tether technical hiring directly.

**Platform: X DM** (Paolo is active, already reacted to the WDK repost chain)

```
Hey Paolo — spent the past week building on QVAC and WDK,
shipped qsearch: the search primitive for QVAC agents where
the LLM cleaning runs locally via @qvac/sdk, not on a cloud API.

7 days, Apache-2.0, full pipeline: github.com/theYahia/qsearch

I'm looking for a role at Tether where I can keep building on
this stack from the inside. Is there a PM/TPM conversation I
should be having?
```

**Why this works:**
- Leads with the artifact, not the ask
- "Paolo" is correct — he's the CEO and public face of Tether
- References `@qvac/sdk` — shows familiarity with their product name
- One-line ask at the end, not a pitch cascade

**Platform: LinkedIn** (if DM is closed or no response within 48h)

Search: "Tether Operations" → HR / People Operations

```
Hi [Name],

I shipped a QVAC-native open-source project this week — qsearch,
a local search API where the LLM cleaning runs on the user's hardware
via @qvac/sdk instead of a cloud endpoint:
github.com/theYahia/qsearch

I'm actively looking for a PM/TPM role focused on QVAC/WDK. Is there
someone on the team I should speak with?

Timur Mamatov
```

---

## Scenario C — Warm intro backup

Trigger: if there's someone in Timur's network who works at Tether or has a direct line to the QVAC team.

**Template (to ask a mutual for an intro):**

```
Hey [Name] — I shipped a project this week that I want to get in
front of the Tether team: qsearch, a search API for QVAC agents
where cleaning runs locally. Apache-2.0, full pipeline working.
github.com/theYahia/qsearch

Do you know anyone on the QVAC/WDK side I should talk to?
I have a conversation in mind for April 21 but want a warm path
as backup. Happy to send more context.
```

---

## Timing rules

| Scenario | When to trigger |
|----------|----------------|
| A (scheduled) | Don't touch B or C — conversation is confirmed |
| B (cold DM) | If A falls through with <24h notice |
| C (warm intro) | Run in parallel with B, not instead of it |

**Never send B and C simultaneously to the same person** — looks desperate.

---

## After the conversation

If the conversation goes well → follow up within 24h with:

```
[Name] — thanks for the time today. I'll have [whatever they asked for]
by [date]. In the meantime: github.com/theYahia/qsearch — all the
artifacts we discussed are there.
```

If they ask for a written summary → send PITCH_NOTE.md content, not this document.
