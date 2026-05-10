# qsearch — Architecture (locked 2026-05-04)

This is the final, locked architecture for qsearch. Each layer below is the result of an explicit research sprint; the alternatives that lost (Hypercore, Tether, on-chain Sybil defense, building our own AT/ActivityPub bridge, subscription-only revenue, etc.) are recorded in `research/`. **A layer is not re-litigated without a new sprint and a recorded decision-log entry.** If a proposal changes one of these layers, surface it as a separate discussion — not a silent edit.

## The 10 layers

| # | Layer | Choice | Notes |
|---|---|---|---|
| 1 | Local trust mesh | ✅ shipped | v0.4.0+ — multi-engine attribution + per-URL provenance |
| 2 | Append-only signed log | SQLite + ed25519 | **NOT** Hypercore |
| 3 | Sync (CRDT) | Yjs (Apache 2.0) | **NOT** Tether |
| 4 | Federation feed format | JSON Feed v1.1 + `_qsearch` extension | RSS-inspired, static |
| 5 | Identity | Passkey-primary + `did:plc` power tier | passkeys for everyone, DID for power users |
| 6 | AT / ActivityPub interop | Bridgy Fed (free, third-party) | we don't build our own bridge |
| 7 | Agent ecosystem | MCP + A2A | both protocols, side by side |
| 8 | Quality gates | Bidirectional RAG validation | ~72% rejection rate target |
| 9 | Sybil defense | Layered, off-chain | WoT + allowlists + PoW + DKIM + diversity heuristics. **No blockchain.** |
| 10 | Revenue | Hybrid | donations + paid hosted + grants |

Last reviewed: 2026-05-04
