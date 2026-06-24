// Filesystem indexing guard (CSO-OPS 2026-05-21 P1-2 + 5.1) — extracted from server.js.
// /index (glob) and /ingest/brave read caller-supplied paths into the searchable corpus.
// Two protections: (1) never index secrets/keys regardless of path, (2) optional hard
// path boundary via QSEARCH_DATA_ROOTS (semicolon-separated).
//
// Keeping the SSRF/path-traversal guard logic in one inspectable, unit-testable place.
import { resolve, sep } from 'node:path'

export const SENSITIVE_FILE_RE = /(^|[/\\])(\.env(\.|$)|.*\.pem$|.*\.key$|id_rsa|id_ed25519|.*\.secret$|credentials)/i

// Computed once at module load from QSEARCH_DATA_ROOTS — same lifecycle as before.
export const ALLOWED_ROOTS = (process.env.QSEARCH_DATA_ROOTS || '')
  .split(';').map(s => s.trim()).filter(Boolean).map(p => resolve(p))

export function withinAllowedRoots (filePath) {
  if (!ALLOWED_ROOTS.length) return true // unset → no boundary (loopback-only dev default)
  const r = resolve(filePath)
  return ALLOWED_ROOTS.some(root => r === root || r.startsWith(root + sep))
}

// Throws if the path must not be ingested. Used per-file in /index and on /ingest dir.
export function assertIndexable (filePath) {
  if (SENSITIVE_FILE_RE.test(filePath)) throw new Error(`refused sensitive file: ${filePath}`)
  if (!withinAllowedRoots(filePath)) throw new Error(`path outside QSEARCH_DATA_ROOTS: ${filePath}`)
}
