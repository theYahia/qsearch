#!/bin/bash
# qsearch MCP demo — run this after both servers are up

echo "=== qsearch MCP Demo ==="
echo ""

# Step 1: initialize and capture session ID from headers
curl -s -D /tmp/mcp_headers -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}}}' > /dev/null

SID=$(grep -i "mcp-session-id" /tmp/mcp_headers | cut -d' ' -f2 | tr -d '\r\n')
echo "Session: $SID"
echo ""

if [ -z "$SID" ]; then
  echo "ERROR: no session ID — is MCP server running on :8081?"
  exit 1
fi

# Step 2: notify
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' > /dev/null

echo "--- tools/list ---"
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | grep "^data:" | sed 's/^data: //' \
  | python -c "import sys,json;d=json.load(sys.stdin);[print(f'  {t[\"name\"]:20s}{t[\"description\"][:70]}') for t in d['result']['tools']]"

echo ""
echo "--- web_search: QVAC SDK edge AI ---"
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_search","arguments":{"query":"QVAC SDK edge AI","n_results":3}}}' \
  | grep "^data:" | sed 's/^data: //' \
  | python -c "import sys,json;d=json.load(sys.stdin);[print(l) for c in d['result']['content'] for l in c['text'].split('\n')[:2]+['']]"

echo "--- news_search: Tether AI 2026 ---"
curl -s -X POST http://localhost:8081/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: $SID" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"news_search","arguments":{"query":"Tether AI 2026","n_results":3}}}' \
  | grep "^data:" | sed 's/^data: //' \
  | python -c "import sys,json;d=json.load(sys.stdin);[print(l) for c in d['result']['content'] for l in c['text'].split('\n')[:2]+['']]"

echo ""
echo "=== done ==="
