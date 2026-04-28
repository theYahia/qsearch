#!/usr/bin/env bash
# Restart qsearch on VPS and verify it's healthy.
# Run after pulling new code: git pull && bash deploy/restart-and-warmup.sh

set -e

echo "=== 1. Restart qsearch ==="
pm2 restart qsearch

echo "=== 2. Wait 5s for node server to bind ==="
sleep 5

echo "=== 3. Health check ==="
curl -sf "http://localhost:8080/health" | head -c 200
echo ""

echo "=== 4. Search smoke test ==="
time curl -s "https://qsearch.pro/search?q=open+source+search&n=3" \
  -o /tmp/qsearch_warmup.json \
  -w "HTTP %{http_code} | %{time_total}s\n" --max-time 30 \
  || echo "(request timed out or failed — check: pm2 logs qsearch)"

echo ""
echo "=== 5. Result count ==="
node -e "
const d = JSON.parse(require('fs').readFileSync('/tmp/qsearch_warmup.json','utf8'))
console.log('total_results:', d.total_results, '| first title:', d.results?.[0]?.title)
" 2>/dev/null || echo "(no JSON — check pm2 logs)"

echo ""
echo "=== DONE. If step 3 returned 200 and step 5 showed results, qsearch.pro is live. ==="
