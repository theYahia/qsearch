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
import re
import html

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

    def result_text(result):
        text = str(result.markdown or result.extracted_content or '')
        if len(text.strip()) >= 200:
            return text
        # Some sites render prose that the markdown generator drops (JS-heavy templates).
        # cleaned_html still holds it — strip tags rather than report the page as empty.
        cleaned = getattr(result, 'cleaned_html', '') or ''
        if cleaned:
            stripped = re.sub(r'<[^>]+>', ' ', re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>', ' ', cleaned))
            stripped = html.unescape(re.sub(r'\s+', ' ', stripped)).strip()
            if len(stripped) > len(text.strip()):
                return stripped
        return text

    async def fetch(url: str, stealth: bool):
        # Plain pass first (fast); anti-bot pass only when it buys something — magic/simulate_user
        # add seconds per page, so they are the retry, not the default.
        browser = BrowserConfig(headless=True, verbose=False, enable_stealth=stealth)
        run = CrawlerRunConfig(only_text=True, verbose=False, **(
            {"magic": True, "simulate_user": True, "override_navigator": True,
             "wait_until": "domcontentloaded", "page_timeout": 45000} if stealth else {}))
        async with AsyncWebCrawler(config=browser) as crawler:
            result = await crawler.arun(url=url, config=run)
            return result, result_text(result)

    async def crawl_url(url: str, current_depth: int):
        if url in visited or current_depth > depth:
            return
        visited.add(url)

        result, text = await fetch(url, stealth=False)
        if not result.success or len(text.strip()) < 200:
            try:
                retry, retry_text = await fetch(url, stealth=True)
                if retry.success and len(retry_text.strip()) > len(text.strip()):
                    result, text = retry, retry_text
            except Exception as e:  # retry is best-effort — keep whatever the plain pass got
                print(f"[crawl4ai] stealth retry failed: {e!r}"[:200], file=sys.stderr)

        if result.success:
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
