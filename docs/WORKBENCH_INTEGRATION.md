# qsearch — Workbench Integration

> How qsearch plugs into QVAC Workbench as an MCP-over-HTTP tool.
> This is the target integration shape for v1.0.

---

## Concept

QVAC Workbench runs local document Q&A. The missing capability is **live web context** — when a user asks about something that isn't in their documents, the agent needs to read the web without leaving the local-first contract.

qsearch fills that gap as a sidecar daemon: Workbench calls `POST /search`, gets cleaned markdown back, injects it into the agent's context. The cleaning runs locally via @qvac/sdk — same runtime Workbench already uses.

---

## MCP Tool Definition

```json
{
  "name": "web_search",
  "description": "Search the live web and return locally-cleaned results. Results are cleaned by a local LLM (Qwen3-0.6B) — no query or content leaves your machine.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query"
      },
      "n_results": {
        "type": "integer",
        "description": "Number of results (1-10, default 3)",
        "default": 3
      }
    },
    "required": ["query"]
  }
}
```

---

## HTTP Transport

qsearch runs as a local daemon on `http://localhost:8080`. Workbench calls it over loopback — no network hop.

```
Workbench agent
    │  tool_call: web_search({ query: "..." })
    ▼
POST http://localhost:8080/search
    │  { "query": "...", "n_results": 3 }
    ▼
qsearch server
    ├─ Brave Search API (outbound, BYOK)
    └─ @qvac/sdk local inference (loopback, no outbound)
    ▼
{ "results": [{ "cleaned_markdown": "..." }] }
    ▼
Workbench injects cleaned_markdown into agent context
```

---

## Example Round-Trip

**User asks Workbench:** *"What did Tether ship this week?"*

**Workbench calls qsearch:**
```bash
POST http://localhost:8080/search
{ "query": "Tether latest release 2026", "n_results": 3 }
```

**qsearch returns:**
```json
{
  "query": "Tether latest release 2026",
  "model": "QWEN3_600M_INST_Q4",
  "brave_ms": 680,
  "results": [
    {
      "url": "https://tether.io/news/...",
      "title": "Tether Launches QVAC SDK 0.8.0",
      "cleaned_markdown": "Tether released QVAC SDK 0.8.0 on April 15, 2026. The update powers QVAC Health 1.1.0 with improved local inference performance and new model support.",
      "clean_ms": 1920
    }
  ]
}
```

**Workbench agent** uses `cleaned_markdown` as retrieved context, answers the user.

---

## Setup (v1.0 target)

```bash
# 1. Clone and install
git clone https://github.com/theYahia/qsearch
cd qsearch && npm install

# 2. Add Brave API key
echo "BRAVE_API_KEY=your_key" > .env.local

# 3. Start sidecar
npm start   # http://localhost:8080

# 4. In Workbench: add MCP server → http://localhost:8080
```

---

## Why not a Workbench plugin?

A plugin would require Workbench to distribute qsearch's binary. A sidecar HTTP daemon:
- Ships independently via `npm`
- Works with any MCP-compatible agent, not just Workbench
- Easy to audit (one HTTP endpoint, one JSON schema)
- Upgradeable without touching Workbench

The MCP-over-HTTP transport is the integration primitive. Workbench is the first consumer.

---

*Integration design: Timur Mamatov (YAHIA). Target: qsearch v1.0, post-2026-04-21.*
