// doesitlie Bench — citation→claim verifier.
//
// The implementation now lives in the canonical qsearch module `src/verifier/index.js`
// (so the same verifier powers the benchmark, the RaaS report generator, and the live
// qsearch /verify endpoint — one implementation, no drift). This file is a thin re-export
// kept so doesitlie's `./verifier.js` import sites (harness.js, validate.mjs) are unchanged
// and the published numbers stay byte-reproducible against the committed verdict cache.
//
// Public API: VERDICTS, rankParagraphs, judgeLabel, verifyCitation.
export * from '../../src/verifier/index.js'
