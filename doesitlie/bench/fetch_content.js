// doesitlie Bench — content fetcher.
//
// Moved to the canonical qsearch module `src/verifier/fetch_content.js`. Thin re-export kept
// for backward compatibility (no current in-tree importer besides the verifier, which now
// imports its sibling directly — see src/verifier/index.js).
export * from '../../src/verifier/fetch_content.js'
