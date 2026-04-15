# Why cleaning needs to run on your hardware, not ours

*Published as part of the qsearch build-in-public series. Day 5 of 7.*

---

There's a gap in the local AI stack that nobody talks about because it looks small. It isn't.

Tether shipped QVAC SDK on April 9, 2026. WDK followed on April 13. Both share the same architectural principle: intelligence runs on your device, not on a server you rent access to. An agent built on this stack can answer questions from your documents, run inference locally, manage a self-custodial wallet — and none of that data ever leaves your machine.

Then you ask it to search the web.

And the whole thing falls apart.

---

## The half-sovereign problem

Every search API available to AI agents today does the same thing. You send a query to their server. Their server fetches results. Their server cleans and structures those results. Their server sends back the answer.

Exa does this. Tavily does this. Perplexity Sonar does this. They all have privacy policies. Most of them have zero-data-retention clauses. But the data still flows through infrastructure you don't control.

For a QVAC agent running locally on a laptop or phone, this is architecturally incoherent. The agent's prompts, memory, and inference run on your hardware. But the moment it needs to read the live web, it phones home.

An agent that keeps your health data local but sends your search queries to a cloud API is **half-sovereign**. The architecture doesn't hold end-to-end.

qsearch is the primitive that closes that gap.

---

## How qsearch works

The pipeline has three steps, and the key is where each step runs.

**Step 1 — Brave fetch (outbound, BYOK)**

```
POST /search { "query": "qvac sdk", "n_results": 2 }
    ↓
Brave Search API (your key, your quota, no intermediary)
    ↓
raw results: title, url, description snippet
```

Brave is the search backend because it's the only one where the full architecture holds. Independent index (not a Google/Bing wrapper), Data-for-AI tier with explicit ToS permission for AI transformation of results, BYOK so the API key and quota are yours. The query goes to Brave. That's the only external hop.

**Step 2 — Local LLM cleaning (zero outbound)**

```
raw result (title + url + description)
    ↓
@qvac/sdk — Qwen3-0.6B Q4, running on your CPU
    ↓
cleaned_markdown: "QVAC is a decentralized, local AI platform..."
```

This is the green node. The model — 364MB, quantized, cached at `~/.qvac/models/` — reads the raw snippet and writes a clean 1-2 sentence summary. The inference happens in a bare worker process spawned locally by `@qvac/sdk`. No network call. No cloud API. The cleaning step is architecturally identical to how QVAC Health processes your vitals: on your machine, in your memory, under your control.

**Step 3 — Structured JSON out**

```json
{
  "query": "qvac sdk",
  "model": "QWEN3_600M_INST_Q4",
  "brave_ms": 819,
  "results": [
    {
      "url": "https://qvac.tether.io/",
      "title": "QVAC - Decentralized, Local AI in a Single API",
      "description": "QVAC is Tether's answer to centralized AI...",
      "cleaned_markdown": "QVAC is a decentralized, local AI platform built on Tether, offering a new paradigm where intelligence runs privately, locally, and without permission on any device.",
      "clean_ms": 1420
    },
    {
      "url": "https://tether.io/news/tether-launches-qvac-sdk...",
      "title": "Tether Launches QVAC SDK...",
      "description": "QVAC SDK is a unified software development kit...",
      "cleaned_markdown": "Tether.io launched the QVAC SDK, a unified AI development kit enabling AI training and evolution across any device and platform.",
      "clean_ms": 1008
    }
  ]
}
```

`brave_ms` is the Brave fetch latency — the only outbound network hop. `clean_ms` is inference time per result — 1.4s and 1.0s on a laptop CPU for Qwen3-0.6B. This is real output from the Day 3 run. That's the whole pipeline. The agent gets structured, readable content without any cleaning happening outside its hardware boundary.

---

## Why not just use Exa

Exa is excellent. Tavily is excellent. If you're building a cloud application and you want the best snippet quality with the least friction, use them.

qsearch doesn't beat them on snippet quality. A 600M parameter model running on your laptop cannot out-clean a large model running on a datacenter GPU. That's not the point.

The wedge is architectural. qsearch wins when:

1. **You're building on QVAC/WDK** and the local-first contract matters. A QVAC agent that calls Exa is architecturally inconsistent — the agent's threat model includes "data doesn't leave my hardware" but search queries do.

2. **You need auditability.** qsearch is Apache-2.0 OSS. You can read every line of the cleaning step. With cloud APIs, you audit a privacy policy.

3. **You're air-gapped or on a restricted network.** Local inference + BYOK Brave = the only external dependency is the search fetch itself, which you can route through your own proxy or eventually replace with a self-hosted index.

The comparison table from the README says it clearly:

|  | Exa | Tavily | Sonar | **qsearch** |
|---|---|---|---|---|
| OSS core | ❌ | ❌ | ❌ | ✅ |
| LLM cleaning | ✅ (cloud) | ✅ (cloud) | ✅ (cloud) | ✅ (**local**) |
| QVAC-native | ❌ | ❌ | ❌ | ✅ |
| Self-hostable | ❌ | ❌ | ❌ | ✅ |

---

## The cleaning step, line by line

Here's the actual inference call from `src/server.js`:

```javascript
import { loadModel, completion, QWEN3_600M_INST_Q4 } from '@qvac/sdk'

// Load once at startup — bare worker spawns, model loads from ~/.qvac/models/
const modelId = await loadModel({
  modelSrc: QWEN3_600M_INST_Q4,   // registry://hf/unsloth/Qwen3-0.6B-GGUF/...
  modelType: 'llamacpp-completion',
  onProgress: (p) => process.stdout.write(`\rModel: ${p.percentage}%`)
})

// Per result — no network call, pure local inference
const result = completion({
  modelId,
  history: [
    {
      role: 'system',
      content: 'You are a search result cleaner for a local AI agent. /no_think\n' +
               'Extract key information as 1-2 concise sentences of plain prose.\n' +
               'No bullet points. No headers. Return only the cleaned sentences.'
    },
    {
      role: 'user',
      content: `Title: ${item.title}\nURL: ${item.url}\nDescription: ${item.description}`
    }
  ],
  stream: false
})

const cleaned_markdown = (await result.text)
  .replace(/<think>[\s\S]*?<\/think>/g, '')
  .trim()
```

Three things worth noting:

**`QWEN3_600M_INST_Q4` is a registry constant.** It resolves to a Pear/HuggingFace URL baked into `@qvac/sdk`. The SDK downloads and caches the model on first load — 364MB, verified by SHA-256 checksum, never re-downloaded. This is the same model registry mechanism QVAC Health uses for its local models.

**`/no_think` disables Qwen3's chain-of-thought mode.** Qwen3 has a built-in thinking mode that outputs `<think>...</think>` reasoning blocks before the final answer. For a search cleaner we want direct output, not reasoning. The `/no_think` token in the system prompt suppresses it; the regex strips any residual tags as belt-and-suspenders.

**Sequential, not parallel.** The pipeline cleans results one at a time. Concurrent inference on a single loaded model creates race conditions in the bare worker. Sequential is the correct call for v0.1 — parallel cleaning is a v0.2 optimisation after validating the worker's concurrency model.

---

## What's missing (honest)

**Snippet quality.** Qwen3-0.6B produces coherent summaries but it's a 600M parameter model. It makes mistakes. On complex or technical results it sometimes hallucinates. The cleaning step is a 1.4-second local pass, not a deep reasoning pass. Upgrade path: swap `QWEN3_600M_INST_Q4` for `LLAMA_3_2_1B_INST_Q4_0` (737MB) or `QWEN3_1_7B_INST_Q4` (1008MB) — single constant change.

**No PII redaction yet.** The query and snippets pass through the model as-is. v0.2 adds `redact-pii-core@4.0.2` before the inference call to strip emails, phone numbers, and identifiers from the cleaning context.

**Single provider.** Brave only in v0.1. SearXNG as a self-hosted fallback is planned for v0.2 — no API key required, runs on your own index.

**Cold start.** The bare worker spawns and the model loads when the server starts. On a cold machine this takes a few seconds (364MB gguf loaded to RAM + bare worker init). Once warm, inference is ~1s per result. Run it as a long-lived daemon, not a cold lambda.

---

## The bigger picture

qsearch is one component. The stack it's building toward looks like this:

```
QVAC agent
  ├── local documents      ← QVAC Workbench (exists)
  ├── local wallet         ← WDK (exists)
  ├── local web search     ← qsearch (v0.1 today)
  └── local inference      ← @qvac/sdk (exists)
```

When all four layers are running locally, you have an agent that can answer from your files, move value, read the live web, and reason — and none of it requires a cloud dependency. That's what "intelligence should not be a service one rents" means in practice.

qsearch is the open-web hop. The rest of the stack already exists.

---

*Code: [github.com/theYahia/qsearch](https://github.com/theYahia/qsearch) — Apache-2.0, v0.1.0 live.*
*Follow the build: [@TheTieTieTies](https://x.com/TheTieTieTies)*
