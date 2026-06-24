# verifier — citation→claim verification

The trust-layer primitive: given `(claim, url)`, decide whether the cited source **actually
supports** the claim. One implementation, three consumers:

- the **doesitlie** citation-honesty benchmark (`doesitlie/bench/verifier.js` re-exports this module),
- the **RaaS** cited-report generator (`src/raas/verify.js`),
- the live **`POST /verify`** HTTP endpoint and the **`verify_citation`** MCP tool.

## Verdicts

| Verdict | Meaning |
|---|---|
| `Supported` | the source's passages state the claim's core assertion |
| `Partial` | related and partly backs it, but the claim overstates / drifts / adds an absent specific |
| `Unsupported` | core assertion absent, off-topic, or contradicted |
| `Fabricated` | the cited URL is genuinely gone (404/410 / dead domain) — the cite points nowhere |
| `Error` | could not fetch/parse (PDF parse fail, 403/429 bot-block, timeout) — counted in coverage, not hidden |

## How

`fetch_content.js` retrieves readable text (PDF → pdfjs · HTML → SSRF-guarded fetch · 403/JS-shell →
Crawl4AI headless · dead → Fabricated). `rankParagraphs` puts the most relevant passages first
(lexical overlap + exact-anchor boost for statute numbers / dollar amounts / quoted phrases). An
**LLM-as-judge at temperature 0** (local `qwen2.5:14b-instruct`, or DeepSeek when `DEEPSEEK_API_KEY`
is set) returns the verdict + the verbatim supporting quote.

## Reproducibility

Verdicts are cached by `(CACHE_VERSION | judge | url | claim)` so a re-run returns identical results.
Default cache dir is `doesitlie/bench/.cache` (keeps the published benchmark byte-reproducible);
override with `DOESITLIE_CACHE_DIR`. Set `DOESITLIE_NO_CACHE=1` to force recompute.

```js
import { verifyCitation } from './index.js'
const v = await verifyCitation({ claim: '...', url: 'https://...' })
// → { claim, source_url, verdict, evidence, confidence, excerpt, error }
```

## Env

| Var | Default | Purpose |
|---|---|---|
| `DOESITLIE_JUDGE_PROVIDER` | `ollama` (or `deepseek` if key present) | which judge runs |
| `DOESITLIE_JUDGE_MODEL` | `qwen2.5:14b-instruct` | Ollama model |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama endpoint |
| `DOESITLIE_JUDGE_TIMEOUT_MS` | `120000` | per-judge-call timeout |
| `DOESITLIE_CACHE_DIR` | `doesitlie/bench/.cache` | verdict cache location |

Tested in `test/unit/verifier/index.test.js` (ranking + label logic; the judge path's measured
accuracy is the doesitlie gold-agreement number, κ=0.75 binary / 87.3 %).
