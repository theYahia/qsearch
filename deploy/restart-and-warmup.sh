#!/usr/bin/env bash
# Restart qsearch, warm up the model, verify UI fix, confirm warm query works.
# Run after pulling new code that changes index.html (readFileSync caches it on startup).

set -e

echo "=== 1. Restart qsearch ==="
pm2 restart qsearch

echo "=== 2. Wait 5s for node server to bind ==="
sleep 5

echo "=== 3. Warmup query (cold model, expect 60-200s, may 524 on Cloudflare) ==="
time curl -s "https://qsearch.pro/search?q=warmup&n=1" --max-time 200 \
  -o /tmp/qsearch_warmup.json \
  -w "HTTP %{http_code} | %{time_total}s\n" || echo "(warmup may have timed out — that's fine, model is loading)"

echo ""
echo "=== 4. Follow-up query (should be warm now) ==="
time curl -s "https://qsearch.pro/search?q=bitcoin&n=1" --max-time 60 \
  -o /tmp/qsearch_warm.json \
  -w "HTTP %{http_code} | %{time_total}s\n"

echo ""
echo "=== 5. UI fix check (should print 1) ==="
curl -s "http://localhost:8080/" | grep -c "item.cleaned_markdown || ''"

echo ""
echo "=== 6. Cleaned markdown from warm query ==="
python3 -c "
import json
d = json.load(open('/tmp/qsearch_warm.json'))
r = d['results'][0]
print(f'clean_ms: {r[\"clean_ms\"]}ms')
print(f'cleaned: {r.get(\"cleaned_markdown\")}')
" 2>/dev/null || echo "(warm query did not return JSON — check pm2 logs)"

echo ""
echo "=== DONE. If step 5 printed 1 and step 4 returned HTTP 200 < 35s, qsearch.pro is ready ==="
