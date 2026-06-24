#!/usr/bin/env node
// split-to-staging.mjs — deterministic, idempotent repo-split for `doesitlie`.
//
// Rebuilds a clean public staging tree at
//   doesitlie/_publish-staging/doesitlie/
// from the live private subdir `doesitlie/` (inside the qsearch repo), following
// PUBLISH-PLAN.md §1 (manifest), §5 (import-path fix), §6 (checklist).
//
// WIPE-AND-REBUILD: the staging tree is deleted and reconstructed on every run, so the
// result is a pure function of the current source tree — re-running is always safe.
//
// What it does NOT do (guardrails — user presses the buttons): no GitHub repo creation,
// no remote, no push, no npm install (run separately), no DNS, no deploy.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DOESITLIE = path.resolve(__dirname, '..')                       // .../qsearch/doesitlie
const QSEARCH = path.resolve(DOESITLIE, '..')                          // .../qsearch
const STAGING_ROOT = path.join(DOESITLIE, '_publish-staging')          // wipe target parent
const OUT = path.join(STAGING_ROOT, 'doesitlie')                       // the public tree

// ── tiny fs helpers (deterministic, no deps) ─────────────────────────────────
function rmrf (p) { fs.rmSync(p, { recursive: true, force: true }) }
function mkdirp (p) { fs.mkdirSync(p, { recursive: true }) }
function relName (p) { return path.relative(OUT, p).replace(/\\/g, '/') }

// Copy a directory recursively, with an optional filter(srcAbsPath, dirent) => boolean.
// Returns count of files copied.
function copyDir (srcDir, dstDir, filter) {
  let n = 0
  if (!fs.existsSync(srcDir)) throw new Error(`copyDir: source missing: ${srcDir}`)
  mkdirp(dstDir)
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const s = path.join(srcDir, ent.name)
    const d = path.join(dstDir, ent.name)
    if (filter && !filter(s, ent)) continue
    if (ent.isDirectory()) n += copyDir(s, d, filter)
    else if (ent.isFile() || ent.isSymbolicLink()) { fs.copyFileSync(s, d); n++ }
  }
  return n
}

function copyFile (src, dst) {
  if (!fs.existsSync(src)) throw new Error(`copyFile: source missing: ${src}`)
  mkdirp(path.dirname(dst))
  fs.copyFileSync(src, dst)
}

function writeFile (dst, content) { mkdirp(path.dirname(dst)); fs.writeFileSync(dst, content) }
function readStaged (rel) { return fs.readFileSync(path.join(OUT, rel), 'utf-8') }

// Replace exactly one literal occurrence; throw if 0 or >1 (catches silent drift).
function replaceOnce (rel, find, replace, tag) {
  const abs = path.join(OUT, rel)
  const before = fs.readFileSync(abs, 'utf-8')
  const count = before.split(find).length - 1
  if (count !== 1) throw new Error(`[edit ${tag}] expected exactly 1 occurrence of ${JSON.stringify(find)} in ${rel}, found ${count}`)
  fs.writeFileSync(abs, before.replace(find, replace))
}

const log = (...a) => console.log(...a)

// ── 0. WIPE ──────────────────────────────────────────────────────────────────
log('▶ split-to-staging — wipe-and-rebuild')
rmrf(STAGING_ROOT)
mkdirp(OUT)
log(`  staging root reset: ${STAGING_ROOT}`)

// ── 1a. MOVES (public manifest §1a) ──────────────────────────────────────────
// bench/ — EVERYTHING except .cache (.cache is handled by a separate prune step at
// publish time; the task ships the tree WITHOUT cache, leaving it for the prune-step).
let benchN = copyDir(path.join(DOESITLIE, 'bench'), path.join(OUT, 'bench'),
  (s, ent) => !(ent.isDirectory() && ent.name === '.cache' && path.dirname(s) === path.join(DOESITLIE, 'bench')))
log(`  bench/  → ${benchN} files (excluding .cache)`)

// site/ — copy wholesale (pre-built static site, CNAME + .nojekyll included).
const siteN = copyDir(path.join(DOESITLIE, 'site'), path.join(OUT, 'site'))
log(`  site/   → ${siteN} files`)

// .github/ — ISSUE_TEMPLATE/* + workflows/bench-integrity.yml (manifest §1a).
copyFile(path.join(DOESITLIE, '.github/workflows/bench-integrity.yml'), path.join(OUT, '.github/workflows/bench-integrity.yml'))
copyDir(path.join(DOESITLIE, '.github/ISSUE_TEMPLATE'), path.join(OUT, '.github/ISSUE_TEMPLATE'))
log('  .github/ → workflows/bench-integrity.yml + ISSUE_TEMPLATE/*')

// LICENSE (MIT) + DATA_LICENSE (CC-BY) + README.md.
for (const f of ['LICENSE', 'DATA_LICENSE', 'README.md']) {
  copyFile(path.join(DOESITLIE, f), path.join(OUT, f))
}
log('  LICENSE · DATA_LICENSE · README.md')

// ── 1c (a). ROADMAP — ship TRIMMED (phases only; cut kill-metric/monetization/moat/red-lines/GTM) ──
writeFile(path.join(OUT, 'ROADMAP.md'), buildTrimmedRoadmap())
log('  ROADMAP.md → trimmed public version (phases only)')

// (1c excludes: docs/strategy-internal.md, MARATHON-*.md, docs/habr-longread-ru-*.md,
//  docs/launch-kit.md, research/ — simply NOT copied. Nothing to do here.)

// ── 5b. Vendor the 5 transitive source files under a mirrored src/ layout ─────
const VENDOR = [
  'src/verifier/index.js',
  'src/verifier/fetch_content.js',
  'src/fetch/html.js',
  'src/crawl/crawl4ai.js',
  'src/crawl/crawl4ai_worker.py'
]
for (const rel of VENDOR) copyFile(path.join(QSEARCH, rel), path.join(OUT, rel))
log(`  vendored src/ → ${VENDOR.length} files (mirrored layout)`)

// ── 5b edits (mechanical, low-risk) ──────────────────────────────────────────
// (1) bench/verifier.js re-export: ../../src → ../src
replaceOnce('bench/verifier.js', "'../../src/verifier/index.js'", "'../src/verifier/index.js'", '1: bench/verifier.js re-export')
// (2) bench/fetch_content.js re-export: ../../src → ../src
replaceOnce('bench/fetch_content.js', "'../../src/verifier/fetch_content.js'", "'../src/verifier/fetch_content.js'", '2: bench/fetch_content.js re-export')
// (3) vendored src/verifier/fetch_content.js imports ../fetch/html.js + ../crawl/crawl4ai.js
//     stay correct under the mirrored layout → NO edit (asserted below).
{
  const fc = readStaged('src/verifier/fetch_content.js')
  if (!fc.includes("from '../fetch/html.js'") || !fc.includes("from '../crawl/crawl4ai.js'")) {
    throw new Error('[edit 3 assert] vendored fetch_content.js mirrored imports not found as expected')
  }
}
// (5) Trim stale doc-comments referencing the qsearch re-export relationship, in both
//     vendored files (public readers can't see that repo). Replace the multi-line NOTE
//     blocks with a short public-facing line. Idempotent literal swaps.
//     RUN BEFORE edit (4): the index.js CACHE_DIR *comment* also contains the literal
//     'doesitlie/bench/.cache' (so there are 2 occurrences). Rewriting the comment first
//     leaves the code default (line ~177) as the unique occurrence for edit (4).
trimDocComment_indexJs()
trimDocComment_fetchContentJs()

// (4) ⚠️ HIGHEST-RISK EDIT: vendored src/verifier/index.js default CACHE_DIR
//     'doesitlie/bench/.cache' → 'bench/.cache' (cwd is repo root in the standalone repo).
replaceOnce('src/verifier/index.js', "'doesitlie/bench/.cache'", "'bench/.cache'", '4: CACHE_DIR default (HIGHEST RISK)')

// (6) §5d: harness dotenv hop walks ['.env.local','../.env.local','../../.env.local'].
//     The '../../.env.local' (qsearch root) is gone after split AND it contains '../../',
//     which would fail the §6 grep gate (must be zero). Trim to repo-local only.
replaceOnce('bench/harness.js',
  "for (const p of ['.env.local', '../.env.local', '../../.env.local']) {",
  "for (const p of ['.env.local']) {",
  '6: harness.js dotenv hop (§5d, satisfies grep gate)')
log('  applied §5b edits: trimmed doc-comments (5) → CACHE_DIR (4) → re-exports (1)(2) + asserted (3) + harness dotenv (6)')

// ── 5c. staging package.json (public; exact resolved dep versions) ───────────
writeFile(path.join(OUT, 'package.json'), buildPackageJson())
log('  package.json → public (private:false, exact deps)')

// ── 1a / §6. staging .gitignore ──────────────────────────────────────────────
// NOTE: do NOT ignore bench/.cache — the prune step will populate + commit it.
writeFile(path.join(OUT, '.gitignore'), [
  'node_modules/',
  '.env.local',
  '*.log',
  '.DS_Store',
  ''
].join('\n'))
log('  .gitignore → node_modules/ .env.local *.log .DS_Store (cache NOT ignored)')

// ── final accounting ─────────────────────────────────────────────────────────
const allFiles = walk(OUT).map(relName).sort()
log(`\n✔ staging rebuilt: ${allFiles.length} files at ${OUT}`)
// sanity: private files must be absent
for (const banned of ['docs/strategy-internal.md', 'MARATHON-2026-06-07.md', 'docs/launch-kit.md', 'research']) {
  if (fs.existsSync(path.join(OUT, banned))) throw new Error(`LEAK: ${banned} present in staging`)
}
log('  private-exclusion check: docs/strategy-internal.md · MARATHON-*.md · docs/launch-kit.md · research/ — all ABSENT ✓')

// ─────────────────────────────────────────────────────────────────────────────
// builders / helpers
// ─────────────────────────────────────────────────────────────────────────────

function walk (dir) {
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function buildPackageJson () {
  // Exact resolved versions read from qsearch/package-lock.json (lockfileVersion 3).
  const lock = JSON.parse(fs.readFileSync(path.join(QSEARCH, 'package-lock.json'), 'utf-8'))
  const pkgs = lock.packages || {}
  const cheerio = pkgs['node_modules/cheerio']?.version
  const pdfjs = pkgs['node_modules/pdfjs-dist']?.version
  if (!cheerio || !pdfjs) throw new Error(`could not resolve dep versions from lock: cheerio=${cheerio} pdfjs-dist=${pdfjs}`)
  const obj = {
    name: 'doesitlie-bench',
    version: '0.2.0',
    private: false,
    type: 'module',
    description: 'A neutral, reproducible benchmark for citation honesty in AI deep-research agents.',
    license: 'MIT',
    homepage: 'https://doesitlie.org',
    repository: { type: 'git', url: 'https://github.com/theYahia/doesitlie.git' },
    engines: { node: '>=20' },
    dependencies: {
      cheerio,
      'pdfjs-dist': pdfjs
    },
    scripts: {
      test: 'node --test bench/test/*.test.js',
      bench: 'node bench/harness.js',
      build: 'node site/build_site.mjs',
      validate: 'node bench/validate.mjs',
      agreement: 'node bench/agreement.js'
    }
  }
  return JSON.stringify(obj, null, 2) + '\n'
}

// Trim the qsearch-coupling NOTE in the vendored verifier index.js (lines ~1-27).
// Replace the canonical-module preamble with a public-facing note; keep design content.
function trimDocComment_indexJs () {
  const rel = 'src/verifier/index.js'
  const original =
`// qsearch — citation→claim verifier (canonical module).
//
// Given (claim, cited_url), decides whether the cited source actually SUPPORTS the claim.
// This is the trust-layer primitive: it powers the doesitlie citation-honesty benchmark
// (doesitlie/bench/verifier.js re-exports this file unchanged) AND the RaaS cited-report
// generator (src/raas/verify.js), and is exposed as a live qsearch capability (HTTP /verify
// + the verify_citation MCP tool). One implementation, three consumers.
//`
  const replacement =
`// doesitlie — citation→claim verifier.
//
// Given (claim, cited_url), decides whether the cited source actually SUPPORTS the claim.
// This is the trust-layer primitive behind the doesitlie citation-honesty benchmark
// (bench/verifier.js re-exports this module). One implementation; bench/ is the consumer.
//`
  replaceOnce(rel, original, replacement, '5a: index.js canonical-module preamble')

  // The CACHE_DIR comment also names qsearch consumers (RaaS) — neutralize that line.
  const cacheComment =
`// Cache: CACHE_DIR defaults to the cwd-relative 'doesitlie/bench/.cache' so the published
//   benchmark stays byte-reproducible against its committed verdict cache. Other consumers
//   (RaaS) point DOESITLIE_CACHE_DIR at their own cache dir; the cache KEY is consumer-agnostic
//   (CACHE_VERSION|judge|url|claim) so a shared cache is safe and intended.`
  const cacheReplacement =
`// Cache: CACHE_DIR defaults to the cwd-relative 'bench/.cache' so the published benchmark
//   stays byte-reproducible against its committed verdict cache. Override with
//   DOESITLIE_CACHE_DIR; the cache KEY is (CACHE_VERSION|judge|url|claim).`
  replaceOnce(rel, cacheComment, cacheReplacement, '5b: index.js CACHE_DIR comment')
}

// Trim the "thin re-export kept for the qsearch module" doc-comment in vendored fetch_content.js.
function trimDocComment_fetchContentJs () {
  const rel = 'src/verifier/fetch_content.js'
  const original =
`// qsearch verifier — content fetcher with fallback chain (closes the Error gap).`
  const replacement =
`// doesitlie verifier — content fetcher with fallback chain (closes the Error gap).`
  replaceOnce(rel, original, replacement, '5c: fetch_content.js header')

  const sibling =
`// Reuses public, battle-tested repos only (pdfjs = Mozilla/Firefox engine; Crawl4AI = Playwright-based).
// Sibling of index.js — this is the canonical home; doesitlie/bench/fetch_content.js re-exports it.`
  const siblingReplacement =
`// Reuses public, battle-tested repos only (pdfjs = Mozilla/Firefox engine; Crawl4AI = Playwright-based).
// Sibling of index.js; bench/fetch_content.js re-exports it.`
  replaceOnce(rel, sibling, siblingReplacement, '5d: fetch_content.js sibling comment')
}

// PUBLIC trimmed ROADMAP — phases only. Internal strategy lines removed:
//   kill-metric (Phase 5), monetization (Phase 6), moat / red-lines, GTM specifics,
//   $-agent / revenue framing, risk-monitoring competitor intel.
function buildTrimmedRoadmap () {
  return `# 🗺️ ROADMAP — doesitlie

> doesitlie = открытый НЕЙТРАЛЬНЫЙ бенчмарк честности цитат AI deep-research агентов (legal v1).
> Путь: build-in-public. Открытый, аудируемый репозиторий → референс для индустрии.
> Формат: фазы по порядку; [x] сделано, [ ] в работе.

## Phase 0 — Захардить бенч (pre-publish gate)

> Методология должна пережить первый red-team. Чинить ДО публикации.

- [x] v1-пайплайн (verifier + harness + judge), 2-agent leaderboard Claude DR 83.7% / Gemini 3.1 Pro 77.9%
- [x] **Coverage-adjusted score**: leaderboard показывает Coverage + ✓Supported/total + ✗Unsupported/total + ☠Fabricated/total; Error не прячется. Реальные числа: Claude 60.5% / Gemini 57.1% coverage-adjusted (vs 83.7%/77.9% per-fetched).
- [x] **Демотировать Support%**: Fabricated-rate + Unsupported-rate (over total) = PRIMARY, сортировка по «честности» не по Support%.
- [x] **Cohen's kappa**: agreement.js считает κ (4-way + binary). Реально: binary 87.3% κ=0.750, 4-way 83.6% κ=0.737 (substantial).
- [ ] **Независимый 2-й аннотатор**: 2-й человек грейдит LIVE-источник (не excerpt судьи), re-sample stratified по agent+topic → inter-annotator κ. Хук готов (agreement.js arg3 = labels_2.json).
- [x] **Fix doc/code drift**: verifier docstring + README = реальный lexical-метод + qwen2.5:14b; judge-reproducibility задокументирована (cache-pinned).
- [ ] Прогнать **ChatGPT DR** → 3-agent борд. Запускаемся n=2, ChatGPT DR = первый proof-post (fast-follow).

## Phase 1 — Опубликовать бенч

- [ ] Public GitHub repo (код MIT / данные CC-BY) + audit.json публично на каждую строку
- [ ] Static leaderboard site (doesitlie.org → GH Pages): таблица + coverage% + клик→audit-trail (источник/excerpt)
- [ ] **Citation-артефакт**: stable per-result permalink + «cite this» BibTeX + one-line model-card-ready claim
- [ ] README re-anchored на ЮРИДИЧЕСКУЮ fabrication + Rule 11 hook

## Phase 2 — Дистрибуция / recognition

- [ ] Точный Show HN title (число + метод, называет проигравшего агента)
- [ ] Launch HN solo first (вт-чт ~8am ET); держать каналы для re-amplify
- [ ] Каналы: legal Twitter + r/MachineLearning + r/AI_Agents
- [ ] ПОСЛЕ launch: submit борд в Tow/CJR + Vals AI как citation-offer
- [ ] Blog methodology page

## Phase 3 — Живой лидерборд: контестанты async-дрипом

> Каждый новый агент = свой proof-post/distribution-event.

- [ ] Добавить Perplexity DR, затем Exa Research, затем Parallel / Manus — по одному, каждый = re-share
- [ ] CourtListener / Free Law Project existence-check (legal mechanical anchor)
- [ ] Continuous re-run при обновлении моделей

## Phase 4 — Legal beachhead (ПОСЛЕ public proof-post)

> bar-association = legitimizer. Submit в их существующий процесс, только ПОСЛЕ публичного числа.

- [ ] 1 email в State Bar AI committee (Nevada / ABA Legal Tech) — оффер нейтрального citation-honesty рейтинга
- [ ] Legal-media sanctions-репортёры (Rule 11 angle)

## Лицензии

- MIT (код бенча) + CC-BY (данные) — открыто и аудируемо.
`
}
