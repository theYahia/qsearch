#!/usr/bin/env bash
set -e

# Install mcp-publisher
curl -fsSL "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz -C /usr/local/bin mcp-publisher

# Write server.json inline (avoids GitHub CDN cache)
mkdir -p /tmp/qsearch-publish
cat > /tmp/qsearch-publish/server.json <<'EOF'
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.theyahia/qsearch",
  "title": "qsearch",
  "description": "Multi-engine search for AI agents. Trust scoring, local corpus, MCP-native. Self-hostable, BYOK.",
  "version": "0.4.0",
  "websiteUrl": "https://qsearch.pro",
  "repository": {
    "url": "https://github.com/theYahia/qsearch",
    "source": "github"
  },
  "remotes": [
    {
      "type": "streamable-http",
      "url": "https://qsearch.pro/mcp"
    }
  ]
}
EOF
cd /tmp/qsearch-publish

# Login (откроет URL + код — введи на github.com/login/device)
mcp-publisher login github

# Publish
mcp-publisher publish
