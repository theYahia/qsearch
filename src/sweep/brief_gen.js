// rd275: /research-brief — Lever D, scaffold-only mode.
//
// Load-bearing rule (per CLAUDE.md §4.5): Brier priors, killer questions, and
// verdict criteria are non-fabricable artifacts — they anchor every downstream
// decision in the sprint. Ollama 7b is NOT competent to write them safely.
// So this endpoint hands back a *scaffold*: cluster topic names + a routed
// queries.txt that satisfies the heavy-max numerical floor (≥25 clusters,
// ≥150 queries, ~70/25/5 priority split). Claude finalizes priors / killers /
// verdict at the next session, same pattern as night-loop Phase-4.5 finalize.
//
// Validation gate: heavy tier must reach ≥25 clusters or the call retries with
// a stricter prompt up to 3 times. If still short, scaffold returns anyway
// with `cluster_count_short: true` — better to ship a 22-cluster scaffold the
// user can hand-edit than to fail the whole endpoint.

import { ollamaComplete, localLlmAvailable } from '../clean/ollama.js'

const HEAVY_FLOOR_CLUSTERS = 25
const STANDARD_FLOOR_CLUSTERS = 12
const LIGHT_FLOOR_CLUSTERS = 5
const MAX_RETRIES = 3

const QUERIES_PER_CLUSTER = { heavy: 7, standard: 5, light: 3 }

const SYSTEM_PROMPT = `You are a research planner generating a cluster outline for a search sprint. You produce ONLY structural scaffolding — never load-bearing content like priors, killer questions, or verdicts. Those are filled in by a human reviewer.

Output JSON only — no prose, no markdown fences. Schema:
{
  "clusters": [
    { "name": "<short kebab-case slug, e.g. self-hosted-vector-db>", "title": "<2-6 word title>", "angle": "<one sentence what this cluster investigates>" }
  ]
}

Rules:
- Cluster names: kebab-case, lowercase, no spaces, distinct.
- Cover the topic from multiple angles: incumbents, alternatives, benchmarks, pricing, ecosystem, criticism, future trends, edge cases, regulation if relevant.
- Do not write Brier probabilities, killer questions, or recommendations.`

export function floorFor (tier) {
  if (tier === 'heavy') return HEAVY_FLOOR_CLUSTERS
  if (tier === 'standard') return STANDARD_FLOOR_CLUSTERS
  return LIGHT_FLOOR_CLUSTERS
}

function buildUserPrompt (topic, tier, aperture, retryHint = null) {
  const floor = floorFor(tier)
  const lines = [
    `Topic: ${topic}`,
    `Tier: ${tier} (minimum ${floor} clusters; aim for ${floor + 5}–${floor + 10})`
  ]
  if (aperture) lines.push(`Aperture / focus: ${aperture}`)
  if (retryHint) lines.push(`PREVIOUS ATTEMPT FELL SHORT: ${retryHint}. Be more thorough this round — split broad clusters into multiple specific ones.`)
  lines.push('', 'Return the JSON only.')
  return lines.join('\n')
}

export function parseClusters (raw) {
  if (!raw) return null
  // Strip code fences if the model added them despite instructions.
  const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  // Strip <think> blocks emitted by qwen models.
  const noThink = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  const start = noThink.indexOf('{')
  const end = noThink.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const obj = JSON.parse(noThink.slice(start, end + 1))
    if (!Array.isArray(obj.clusters)) return null
    return obj.clusters
      .map(c => ({
        name: String(c.name || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''),
        title: String(c.title || '').trim(),
        angle: String(c.angle || '').trim()
      }))
      .filter(c => c.name && c.title)
  } catch {
    return null
  }
}

// 70/25/5 priority split across clusters for heavy; lighter mixes for smaller tiers.
export function priorityFor (idx, total, tier) {
  if (tier === 'light') return 'broad'
  if (tier === 'standard') {
    if (idx / total < 0.8) return 'broad'
    return 'focused'
  }
  // heavy
  const frac = idx / total
  if (frac < 0.7) return 'broad'
  if (frac < 0.95) return 'focused'
  return 'critical'
}

export function buildQueriesTxt (clusters, topic, tier) {
  const perCluster = QUERIES_PER_CLUSTER[tier] || QUERIES_PER_CLUSTER.standard
  const rows = []
  const t = topic.trim()
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i]
    const priority = priorityFor(i, clusters.length, tier)
    const seed = c.title || c.name.replace(/-/g, ' ')
    const variants = [
      seed,
      `${seed} ${t}`,
      `${seed} 2026`,
      `${seed} benchmarks`,
      `${seed} comparison`,
      `${seed} self-hosted`,
      `${seed} pricing`,
      `${seed} criticism`,
      `${seed} alternatives`,
      `${seed} review`
    ]
    for (let j = 0; j < perCluster && j < variants.length; j++) {
      rows.push(`${c.name}|${variants[j]}|${priority}`)
    }
  }
  return rows.join('\n')
}

export function buildScaffoldMd (topic, tier, aperture, clusters) {
  const floor = floorFor(tier)
  const short = clusters.length < floor
  const clusterList = clusters
    .map((c, i) => `${i + 1}. **${c.title}** (\`${c.name}\`) — ${c.angle || '<TODO: Claude finalize angle>'}`)
    .join('\n')

  return `---
topic: ${topic}
tier: ${tier}
generated_by: qsearch /research-brief (scaffold-only)
date: ${new Date().toISOString().slice(0, 10)}
status: SCAFFOLD — Claude must finalize load-bearing sections before sprint
---

# 00_brief.md — ${topic}

> ⚠️ SCAFFOLD. Cluster outline + queries.txt generated by Ollama qwen2.5:7b.
> Priors / killer questions / verdict criteria are load-bearing — Claude must
> finalize them before Phase 2.

## Tier
${tier}${short ? ` (⚠️ below floor of ${floor} clusters — consider regenerating or adding clusters manually)` : ''}

${aperture ? `## Aperture\n${aperture}\n` : ''}
## Cluster outline (Ollama-generated, REVIEW)
${clusterList}

## Killer questions
<!-- TODO: Claude finalize. Minimum 5 for standard, 8-10 for heavy. -->
1. <TODO>
2. <TODO>

## Brier priors
<!-- TODO: Claude finalize. Heavy tier ≥25 priors per CLAUDE.md §2.1 floor.
     Format: "P(claim) = 0.XX — rationale" -->
1. <TODO>

## Decision criteria / verdict tree
<!-- TODO: Claude finalize. 4-category verdict for heavy
     (e.g. GO-FOCUSED / GO-BROAD / MAYBE-PILOT / NO-GO). -->

## What I already know
<!-- TODO: Claude finalize from prior research + memory. -->

## Brave sweep plan
- queries.txt: ${clusters.length} clusters, see sibling file.
- Backends: ${tier === 'heavy' ? 'brave + brave/cross_lang + brave/citation_chase + qsearch' : 'brave + qsearch'}
- Engines flag: ${tier === 'heavy' ? '--engines all' : '--engines web'}
- Context flag: ${tier === 'heavy' ? '--include-context --include-context-local' : '--include-context-local'}

## Scope / anti-scope
<!-- TODO: Claude finalize. -->

## Budget
<!-- TODO: Claude finalize. Token cap, wall-clock cap, $ cap. -->
`
}

export async function runBriefScaffold (args) {
  const { topic, tier = 'standard', aperture = null } = args
  if (!topic) throw new Error('topic required')
  if (!localLlmAvailable) throw new Error('local Ollama LLM unavailable — start ollama and pull qwen2.5:7b-instruct')

  const floor = floorFor(tier)
  let clusters = null
  let attempt = 0
  let lastHint = null

  while (attempt < MAX_RETRIES) {
    attempt++
    const userPrompt = buildUserPrompt(topic, tier, aperture, lastHint)
    let raw
    try {
      raw = await ollamaComplete(SYSTEM_PROMPT, userPrompt)
    } catch (e) {
      if (attempt >= MAX_RETRIES) throw new Error(`ollama failed after ${attempt} attempts: ${e.message}`)
      lastHint = `previous attempt errored: ${e.message}`
      continue
    }
    const parsed = parseClusters(raw)
    if (!parsed || parsed.length === 0) {
      lastHint = 'JSON parse failed or empty clusters array; ensure you output valid JSON with non-empty clusters'
      continue
    }
    clusters = parsed
    if (parsed.length >= floor) break
    lastHint = `you returned ${parsed.length} clusters; the floor for tier=${tier} is ${floor}`
  }

  if (!clusters || clusters.length === 0) throw new Error('Ollama failed to produce a valid cluster outline')

  const short = clusters.length < floor
  const queriesTxt = buildQueriesTxt(clusters, topic, tier)
  const scaffoldMd = buildScaffoldMd(topic, tier, aperture, clusters)

  return {
    scaffold_md: scaffoldMd,
    queries_txt: queriesTxt,
    cluster_count: clusters.length,
    cluster_count_short: short,
    cluster_floor: floor,
    attempts: attempt,
    ollama_only_sections: ['cluster_outline', 'queries_txt'],
    claude_required_sections: ['killer_questions', 'brier_priors', 'verdict_criteria', 'decision_tree', 'what_i_already_know', 'scope', 'budget']
  }
}
