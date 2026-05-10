# qsearchcash — concept sketch (2026-05-04)

> 🟡 **PARKING — early sketch, not committed.** Не roadmap, не proposal. Заметка, чтобы не забыть и при триггере быстро восстановить контекст.

## One-liner

**pay-per-fetch becomes pay-per-unique-URL** — a caching layer where the network pays once per URL, not once per requester. Powered by qsearch's signed log + multi-engine provenance.

## Tim's wording (2026-05-04, raw)

> pay-per-fetch becomes pay-per-unique-URL
>
> звучит очень мощно как это можно перевязать с qsearch нашим или отдещльным продуктом делаем qsearchcash ? и там пишем чета повередбай qsearch или окло того или как?
>
> - qsearch = "trust layer for AI agent search"
> - qsearchcash = "pay-per-unique-URL caching" тоже запиши куда-то потом вернемся

## Почему интересно

- **Cache-once-everyone** — текущая модель (Tavily/Exa/Brave) платит за каждый запрос, даже если кто-то рядом только что фетчил тот же URL. Pay-per-unique-URL — экономика as-the-network: первый платит fetch, остальные читают cache почти бесплатно.
- **qsearch как substrate** — `_qsearch` extension (LAYER 4) уже несёт provenance, signed log (LAYER 2) уже доказывает что URL был fetched, RAG gates (LAYER 8) уже валидируют качество. Cache layer садится сверху как natural extension, а не отдельная инфра.
- **Разделение продуктов** — qsearch = open/free trust layer, qsearchcash = monetised caching layer powered by qsearch. Не размывает qsearch positioning, может тянуть LAYER 10 revenue (paid hosted).

## Open questions

- **Платёжный rail.** `docs/x402.md` уже есть — это проработанный кандидат? Stripe? Lightning? Нужно сверить.
- **Кто платит, кому платит.** Fetcher → cache provider? Reader → fetcher (refund)? Auction-style?
- **Privacy.** Если URL = ключ кэша, repo-уровень leaks (URLs которые кто-то фетчил публично). Нужна модель privacy.
- **Sybil на caching layer.** Кто-то может симулировать «fetch» и собирать платежи без реального HTTP-запроса. LAYER 9 защиты переиспользуются?
- **`claude-webcache`** уже cache-инфраструктура (SQLite, hash url+prompt). Это MVP-substrate или самостоятельный продукт без monetisation?

## Связанные артефакты

- [`../x402.md`](../x402.md) — possible payment rail
- [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — LAYER 2 (signed log), LAYER 4 (feed format), LAYER 8 (RAG gates), LAYER 10 (revenue)
- `D:/Yahia/active/claude-webcache/` — existing cache plugin, candidate substrate

## Next step

**Not now.** Wait for trigger:
- Tim revisits explicitly, OR
- Adjacent decision (revenue model, x402 productisation, claude-webcache evolution) forces resolve.

When triggered → screen-niche / office-hours pass first, then decide if heavy research sprint needed.
