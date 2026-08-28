# README demo embed

How the terminal demo gets recorded and embedded in the top-level `README.md`.

## What it shows

`scripts/demo-flow.sh` runs three acts against a live qsearch on `:8080`:

1. **quickstart** — `GET /health` (it's up, owned by you, local)
2. **search** — `POST /sweep` with multi-engine attribution (`engines[]` + count)
3. **verify** — `POST /verify` (does the cited source actually back a claim?)

## Record it

```bash
# 0. bring qsearch up first (the recorder does NOT start anything):
docker compose up -d            # Meilisearch + Qdrant + SearXNG
npm start                       # qsearch on :8080
#    Ollama qwen2.5:14b-instruct running for the /verify act (else verdict = Error)

# 1. record → assets/demo.gif
bash scripts/record-demo.sh     # auto: VHS if installed, else asciinema
```

The recorder auto-detects the backend (prefers **VHS** → deterministic GIF via
`scripts/demo.tape`; falls back to **asciinema** → `assets/demo.cast`, then `agg`
→ GIF if present). If neither tool is installed it prints exact install commands
and exits — see `scripts/record-demo.sh --help`.

> Recording needs a real TTY + live endpoints, so the GIF itself is produced by
> the user running the command above — it cannot be generated headlessly here.

## Embed block (already in README.md, just under the tagline)

```markdown
## Demo

![qsearch terminal demo — quickstart, multi-engine search, citation verify](assets/demo.gif)

> 60-second tour: `/health` → `/sweep` (multi-engine `engines[]`) → `/verify`
> (does the cited source support the claim?). Reproduce it locally:
> [`bash scripts/record-demo.sh`](scripts/record-demo.sh) after `npm start`.
```

`assets/demo.gif` is a placeholder path until the GIF is recorded — the block
renders a broken-image icon on GitHub until `assets/demo.gif` exists, then shows
the demo with no further edits.

## If you only produced a `.cast` (asciinema, no `agg`)

Two options instead of a local GIF:

1. **Upload to asciinema.org** and swap the block for the player badge:
   ```markdown
   [![asciicast](https://asciinema.org/a/REPLACE_ID.svg)](https://asciinema.org/a/REPLACE_ID)
   ```
2. **Make the GIF** from the cast:
   ```bash
   cargo install --git https://github.com/asciinema/agg
   agg assets/demo.cast assets/demo.gif
   ```

## Tuning the scenario

Edit `scripts/demo-flow.sh` (single source of truth — both VHS and asciinema run it).
Useful env overrides when recording:

| Var | Default | Effect |
|---|---|---|
| `QS_QUERY` | `self-hosted search engine 2026` | the `/sweep` query (pick one with real multi-engine consensus) |
| `QS_CLAIM` | `Qdrant is written in Rust.` | the claim verified in act 3 |
| `QS_CLAIM_URL` | `https://github.com/qdrant/qdrant` | the source URL checked against the claim |
| `QS_TYPE_DELAY` | `0.4` | seconds between on-screen commands (readability) |

> Multi-engine `count > 1` in act 2 needs several SearXNG engines healthy. If your
> SearXNG only has Bing live, results show `count=1` (the feature still reads true —
> the narration is about `engines[]` being exposed at all). For a richer frame,
> pick a `QS_QUERY` you have already swept a few times so the corpus has provenance.
