#!/usr/bin/env bash
set -e

# Install mcp-publisher
curl -fsSL "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz" | tar xz -C /usr/local/bin mcp-publisher

# Pull server.json
mkdir -p /tmp/qsearch-publish
curl -fsSL https://raw.githubusercontent.com/theYahia/qsearch/main/server.json -o /tmp/qsearch-publish/server.json
cd /tmp/qsearch-publish

# Login (откроет URL + код — введи на github.com/login/device)
mcp-publisher login github

# Publish
mcp-publisher publish
