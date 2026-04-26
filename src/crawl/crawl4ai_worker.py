#!/usr/bin/env python3
"""Crawl4AI worker — spawned by crawl4ai.js via child_process.spawn.
Writes one JSON object per line to stdout: {"url": "...", "title": "...", "text": "..."}
"""
import asyncio
import json
import sys
import argparse
import os
import io

# Force UTF-8 stdout/stderr to avoid cp1251 crash on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--depth', type=int, default=1)
    args = parser.parse_args()

    asyncio.run(crawl(args.url, args.depth))

async def crawl(start_url: str, depth: int):
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
    except ImportError:
        print(json.dumps({"error": "crawl4ai not installed — run: pip install crawl4ai==0.8.6"}), flush=True)
        sys.exit(1)

    visited = set()

    async def crawl_url(url: str, current_depth: int):
        if url in visited or current_depth > depth:
            return
        visited.add(url)

        async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False)) as crawler:
            result = await crawler.arun(url=url, config=CrawlerRunConfig(only_text=True))
            if result.success:
                text = result.markdown or result.extracted_content or ''
                print(json.dumps({
                    "url": url,
                    "title": result.metadata.get('title', url) if result.metadata else url,
                    "text": text[:8000]
                }), flush=True)

                if current_depth < depth and result.links:
                    links = result.links.get('internal', [])[:10]
                    for link in links:
                        href = link.get('href', '')
                        if href.startswith('http'):
                            await crawl_url(href, current_depth + 1)

    await crawl_url(start_url, 0)

if __name__ == '__main__':
    main()
