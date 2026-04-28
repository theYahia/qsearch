#!/usr/bin/env bash
# Deploy qsearch MCP-over-HTTP alongside the REST server.
# Adds a second pm2 process (qsearch-mcp on :8081) and updates nginx to
# route /mcp -> :8081. Idempotent — safe to re-run.

set -e

cd "$(dirname "$0")/.."

echo "=== 1. Update nginx (backup + new config + test + reload) ==="
cp /etc/nginx/sites-available/default /etc/nginx/sites-available/default.bak.$(date +%s)
cp deploy/nginx.conf /etc/nginx/sites-available/default
nginx -t
systemctl reload nginx
echo "    nginx reloaded"

echo ""
echo "=== 2. Start or restart qsearch-mcp pm2 process ==="
if pm2 describe qsearch-mcp > /dev/null 2>&1; then
  pm2 restart qsearch-mcp
else
  pm2 start src/mcp-http.js --name qsearch-mcp
fi
pm2 save
echo "    qsearch-mcp running on :8081"

echo ""
echo "=== 3. Wait 3s for MCP server to bind ==="
sleep 3

echo ""
echo "=== 4. Smoke test — MCP endpoint should respond ==="
curl -s -o /tmp/mcp_check.txt -w "HTTP %{http_code} | %{time_total}s\n" \
  -X POST https://qsearch.pro/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0.0.1"}}}'
echo "--- response body (first 500 chars) ---"
head -c 500 /tmp/mcp_check.txt || true

echo ""
echo ""
echo "=== DONE. MCP HTTP server config: ==="
cat <<'JSON'
{
  "qsearch": {
    "type": "http",
    "url": "https://qsearch.pro/mcp"
  }
}
JSON
echo ""

