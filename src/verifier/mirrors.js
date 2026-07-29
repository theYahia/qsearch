// Canonical public mirrors for sources that block robots.
//
// Some publishers (Justia behind Cloudflare, uscode.house.gov) serve a human a full document and
// serve a crawler a challenge page. Scoring those citations as unverifiable would punish agents for
// their publisher's bot policy, so we re-read THE SAME DOCUMENT from a canonical public mirror —
// Cornell LII, California's own leginfo — and record where we read it.
//
// Rules this file obeys, because a mirror is a substitution and substitutions must be disciplined:
//   1. Template-only. vol/page/section come out of the URL itself — no search, no fuzzy matching,
//      no "closest case". A wrong mirror is worse than an honest Error.
//   2. Public-domain primary documents only (court opinions, statutes) — never a secondary source,
//      analysis or blog post, where "the same text elsewhere" isn't a meaningful claim.
//   3. Dead links are never mirrored (see fetch_content.js): a 404 is Fabricated, and a mirror must
//      not resurrect a citation that points nowhere.
//   4. Every mirrored verdict carries `checked_via` into the receipt — the reader sees the swap.
//
// Returns [] for anything not covered. That's the honest default: the citation stays an Error.

const rules = [
  // supreme.justia.com/cases/federal/us/457/800/  →  U.S. Reports vol 457, page 800.
  // Newer cases carry a docket in the page slot (…/us/603/23-939/) — Cornell keys those by docket.
  {
    test: /^https?:\/\/supreme\.justia\.com\/cases\/federal\/us\/(\d+)\/([^/?#]+)/i,
    mirrors: ([, vol, page]) => (/^\d+$/.test(page)
      ? [
          { url: `https://www.law.cornell.edu/supremecourt/text/${vol}/${page}`, label: `Cornell LII — ${vol} U.S. ${page}` },
          { url: `https://caselaw.findlaw.com/court/us-supreme-court/${vol}/${page}.html`, label: `FindLaw — ${vol} U.S. ${page}` }
        ]
      : [{ url: `https://www.law.cornell.edu/supremecourt/text/${page}`, label: `Cornell LII — No. ${page}` }])
  },
  // law.justia.com/codes/california/code-bpc/…/section-16602-5/  →  Cal. Bus. & Prof. Code § 16602.5
  // (leginfo is the State of California's own publication of its codes).
  {
    test: /^https?:\/\/law\.justia\.com\/codes\/california\/code-([a-z]+)\/.*?section-([\d-]+)/i,
    mirrors: ([, code, section]) => {
      const num = section.replace(/-/g, '.').replace(/\.$/, '')
      const upper = code.toUpperCase()
      return [{
        url: `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=${upper}&sectionNum=${num}.`,
        label: `California leginfo — ${upper} § ${num}`
      }]
    }
  },
  // uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title17-section107  →  17 U.S.C. § 107
  {
    test: /^https?:\/\/uscode\.house\.gov\/view\.xhtml\?.*?title(\d+)-section([\w.-]+)/i,
    mirrors: ([, title, section]) => [
      { url: `https://www.law.cornell.edu/uscode/text/${title}/${section}`, label: `Cornell LII — ${title} U.S.C. § ${section}` }
    ]
  },
  // govinfo.gov/app/details/USCODE-2010-title17/USCODE-2010-title17-chap1-sec107  →  17 U.S.C. § 107
  {
    test: /^https?:\/\/(?:www\.)?govinfo\.gov\/app\/details\/USCODE-\d+-title(\d+)\/.*?sec([\w.-]+)/i,
    mirrors: ([, title, section]) => [
      { url: `https://www.law.cornell.edu/uscode/text/${title}/${section}`, label: `Cornell LII — ${title} U.S.C. § ${section}` }
    ]
  }
]

/** Canonical mirrors for a bot-blocked primary source, best first. [] when none apply. */
export function mirrorsFor (url) {
  for (const rule of rules) {
    const m = rule.test.exec(url)
    if (m) return rule.mirrors(m)
  }
  return []
}
