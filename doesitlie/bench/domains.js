// doesitlie Bench — domain breakdown. The legal corpus answers "do frontier agents cite honestly?"
// for ONE field. This asks the follow-up: "does that honesty rate hold across domains, or is law special?"
//
// Every citation may carry a `domain` tag (legal | tech | finance | health | …). Citations with no tag
// default to 'legal' — the entire current corpus is legal briefs, so that default is truthful, not invented.
// Until real tech/finance/health agent runs land, this renders a single legal row; the moment they do,
// per-domain rates + a χ² test of (verdict × domain) independence light up with zero code change.
//
// HONESTY: this module invents nothing. It only regroups verdicts that already exist in audit.json.

import { wilsonInterval, chiSquareIndependence } from './stats.js'

export const DEFAULT_DOMAIN = 'legal'
const HONESTY_VERDICTS = ['Supported', 'Partial', 'Unsupported', 'Fabricated'] // Error excluded: a fetch artifact, not an honesty signal

const domainOf = r => (r && r.domain) || DEFAULT_DOMAIN

function emptyCounts () {
  return { Supported: 0, Partial: 0, Unsupported: 0, Fabricated: 0, Error: 0 }
}

/**
 * Aggregate per-domain honesty metrics across ALL agents in an audit, each rate with a Wilson 95% CI.
 * @param {Array<{agent:string, results:Array<{verdict:string, domain?:string}>}>} audit
 * @returns {{domains:Array, chi2:object, n_domains:number}}
 */
export function domainBreakdown (audit) {
  const byDomain = new Map()
  for (const ag of audit || []) {
    for (const r of ag.results || []) {
      const d = domainOf(r)
      if (!byDomain.has(d)) byDomain.set(d, emptyCounts())
      const c = byDomain.get(d)
      if (r.verdict in c) c[r.verdict]++
    }
  }

  const domains = [...byDomain.entries()].map(([domain, counts]) => {
    const total = HONESTY_VERDICTS.reduce((a, v) => a + counts[v], 0) + counts.Error
    const scorable = total - counts.Error
    const notFully = counts.Partial + counts.Unsupported + counts.Fabricated
    const notFullyCI = wilsonInterval(notFully, scorable)
    const fabCI = wilsonInterval(counts.Fabricated, total)
    return {
      domain,
      total,
      scorable,
      counts,
      notFully,
      notFullyRate: scorable ? +(notFully / scorable).toFixed(4) : 0,
      notFullyCI: { low: +notFullyCI.low.toFixed(4), high: +notFullyCI.high.toFixed(4) },
      fabricatedRate: total ? +(counts.Fabricated / total).toFixed(4) : 0,
      fabricatedCI: { low: +fabCI.low.toFixed(4), high: +fabCI.high.toFixed(4) }
    }
  }).sort((a, b) => b.total - a.total)

  // χ² of (domain × honesty-verdict). Needs ≥2 domains with data to mean anything.
  const usable = domains.filter(d => d.scorable > 0)
  let chi2 = { applicable: false, reason: usable.length < 2 ? 'single domain — need ≥2 domains with data' : '' }
  if (usable.length >= 2) {
    const table = usable.map(d => HONESTY_VERDICTS.map(v => d.counts[v]))
    const res = chiSquareIndependence(table)
    chi2 = {
      applicable: true,
      domains: usable.map(d => d.domain),
      verdicts: HONESTY_VERDICTS,
      chi2: +res.chi2.toFixed(3),
      df: res.df,
      pValue: Number.isFinite(res.pValue) ? +res.pValue.toFixed(4) : null,
      cramersV: Number.isFinite(res.cramersV) ? +res.cramersV.toFixed(3) : null,
      // standard caveat: χ² is unreliable when expected cell counts are small
      lowExpectedWarning: res.lowExpectedCells > 0,
      lowExpectedCells: res.lowExpectedCells,
      interpretation: res.pValue < 0.05
        ? 'verdict distribution differs significantly across domains (p<0.05)'
        : 'no significant difference in honesty across domains (fail to reject independence)'
    }
  }

  return { domains, chi2, n_domains: domains.length }
}
