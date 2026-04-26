import urllib.request, json, sys

BASE = "http://localhost:8081/mcp"
HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}

def mcp(payload, sid=None):
    h = dict(HEADERS)
    if sid:
        h["mcp-session-id"] = sid
    req = urllib.request.Request(BASE, json.dumps(payload).encode(), h)
    resp = urllib.request.urlopen(req)
    sid_out = resp.headers.get("mcp-session-id")
    body = resp.read().decode()
    for line in body.strip().split("\n"):
        if line.startswith("data: "):
            return json.loads(line[6:]), sid_out or sid
    if body.strip():
        return json.loads(body), sid_out or sid
    return None, sid_out or sid

print("=== qsearch MCP Demo ===\n")

_, sid = mcp({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"demo","version":"1.0"}}})
print(f"Session: {sid}\n")

mcp({"jsonrpc":"2.0","method":"notifications/initialized"}, sid)

print("--- tools/list ---")
r, sid = mcp({"jsonrpc":"2.0","id":2,"method":"tools/list"}, sid)
for t in r["result"]["tools"]:
    print(f"  {t['name']:20s}{t['description'][:70]}")

print("\n--- web_search: QVAC SDK edge AI ---")
r, sid = mcp({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"web_search","arguments":{"query":"QVAC SDK edge AI","n_results":3}}}, sid)
for c in r["result"]["content"]:
    lines = c["text"].split("\n")
    print(lines[0])
    if len(lines) > 1:
        print(lines[1])
    print()

print("--- news_search: Tether AI 2026 ---")
r, sid = mcp({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"news_search","arguments":{"query":"Tether AI 2026","n_results":3}}}, sid)
for c in r["result"]["content"]:
    lines = c["text"].split("\n")
    print(lines[0])
    if len(lines) > 1:
        print(lines[1])
    print()

print("=== done ===")
