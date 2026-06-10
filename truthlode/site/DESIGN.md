# Truthlode site — DESIGN (v2 · Forensic Dossier)

## Theme sentence
Skeptical AI researcher / legal-tech / journalist, at a desk in daylight, in a **"prove it to me"** mood. The page reads as a **leaked court exhibit / case file**, not a SaaS dashboard. Trust comes from evidence on the page, not visual energy.

## Why this look (not LMArena, not a framework)
LMArena earns trust by **scale**; we have n=55 — so we earn it by **verifiability**. Frameworks (React/Tailwind/shadcn) produce the generic AI-slop look; beauty here is **craft**: real type, bold scale, a committed aesthetic. Stack stays static, zero-build.

## Type (the #1 anti-slop lever — self-hosted, no third-party calls)
- **Fraunces** (display serif, 400/600/900) — hero + headings + agent names + body prose. High-contrast, characterful = the "exhibit" voice.
- **IBM Plex Mono** (400/500) — ledger, data, receipts, labels, the stamp. Technical-document feel = evidence.
- system sans — only tiny supporting copy.
- woff2 in `fonts/`, `@font-face`, latin subset (~18KB each). No Google Fonts / CDN at runtime — matches the neutral/sovereign brand.

## Palette (OKLCH, low-chroma, AA ≥4.5)
Warm cream paper `oklch(0.971 0.012 85)` · warm ink `oklch(0.245 0.022 60)` · **oxblood accent** `oklch(0.43 0.13 26)` (stamp, links, fabricated — used sparingly). Verdicts muted & deep for AA: sup 150°, par 95°, uns 58°, fab=oxblood 26°, err neutral. No pure black/white. Whisper-faint SVG paper grain on `body::before`.

## Forensic-dossier elements
- **Masthead** = case-file meta line + Fraunces wordmark + CSS rubber **stamp** ("NEUTRAL / AUDITED / no vendor $", rotated −8°, one-time ink-press settle).
- **Hero** = huge Fraunces-900 question, big scale-jump, serif sub.
- **Leaderboard** = "Exhibit A — the record": ledger rows numbered `01/02` (mono, oxblood), hairlines, agent names in serif, ☠Fabricated column set apart by color + hairline (no side-stripe).
- **Receipt drawer** = inline "Exhibit": mono evidence box, serif evidence quote with left rule, source as mono case-citation. Reveal via opacity+translateY ease-out.
- **Trust** = "Chain of custody": 5 numbered (decimal-leading-zero) points.
- **Method** = "Method of record": κ + every conflict listed openly.
- **Footer** = "Filed neutral" seal + neutrality facts (mono).

## Five Laws / bans
OKLCH + AA ✓ · serif display / mono ledger, ≤66ch prose, scale jumps, line-height 1.45–1.65 ✓ · inline drawer, no modal, no card-in-card, text off the edge ✓ · motion = opacity/transform ease-out, `prefers-reduced-motion` honored, no bounce, no layout-property animation ✓ · hero = question, not a 5-metric row ✓. No side-stripe / gradient-text / glassmorphism. Copy passes brand-swap (substitute "Vals AI" → per-citation exhibits, no-vendor-money, mechanical-Fabricated, legal-first, κ-with-visible-conflicts, "we don't rank ourselves" become false).

## Build
`build_site.mjs` (audit.json + gold → `data.json`, recomputes κ) → `index.html` + `style.css` + `app.js` (vanilla) + `fonts/`. Static, GH Pages (`.nojekyll`). Preview: `python -m http.server` here.
