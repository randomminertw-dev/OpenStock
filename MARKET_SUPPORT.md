# Market support

What OpenStock can show depends on two free data sources. This table was tested against both on the free plans (September 2026). Paid Finnhub or TradingView plans unlock more.

| Market | Charts and widgets (TradingView embeds) | Our quotes, watchlist prices, alerts (Finnhub free) |
|---|---|---|
| 🇺🇸 United States (NYSE, Nasdaq, AMEX) | Live | Yes |
| Crypto (Binance pairs, e.g. `BINANCE:BTCUSDT`) | Live | Yes |
| Forex (e.g. `FX:EURUSD`) | Live | No |
| 🇨🇦 Canada (TSX) | Delayed | No |
| 🇦🇺 Australia (ASX) | Delayed | No |
| 🇮🇳 India, through BSE (`.BO`; `.NS` symbols are charted on BSE) | End of day | No |
| 🇩🇪 Germany (Xetra) | End of day | No |
| India NSE (charted on BSE instead) | Blocked in embeds | No |
| London, Tokyo, Hong Kong, Korea, Taiwan, Singapore, New Zealand, Thailand, Malaysia, Istanbul, TSX Venture, Mexico, Johannesburg | Candle chart blocked; financials, technicals and profile work | No |
| Index tickers such as NIFTY, FTSE 100, DAX, Nikkei 225, Hang Seng | Blocked in embeds | No |

## What that means in the app

- **Dashboard:** pick a market (US, India, Germany, Canada, Australia, Crypto, Forex). US and crypto tiles use our own cached quotes; the others use TradingView quote tiles.
- **Stock pages:** symbols Finnhub can price get the full header (live price, day range, market cap). Others get TradingView's quote panel.
- **Alerts:** an OpenStock Cloud feature (or self-hosted in realtime mode). US stocks and crypto only, because the alert checker needs a quote source it can call every five minutes.
- **Search:** Finnhub search returns listings worldwide. On exchanges whose chart is blocked, the stock page links to the chart on TradingView instead (the list is `CHART_BLOCKED_EXCHANGES` in `lib/utils.ts`, each confirmed with two tickers).

## Historical candles for technical indicators

Quotes and embedded TradingView widgets are independent of the candle data used by the 57-indicator engine.

| Symbols | Daily history | Notes |
|---|---|---|
| US stocks | Alpaca → Finnhub fallback | Alpaca credentials required; Finnhub candle access depends on plan |
| `BINANCE:BTCUSDT` and other Binance spot pairs | Binance public market-data API | Exact pair, completed UTC daily bars; no key |
| `CG:bitcoin` and other CoinGecko IDs | CoinGecko symbol lookup → Alpaca crypto | Requires an available Alpaca pair and Alpaca credentials |
| `2330.TW`, `TWSE:2330`, `.TWO`, `TPEX:` | FinMind `TaiwanStockPrice` | Unadjusted Taipei end-of-day data; optional `FINMIND_API_TOKEN` |
| Other international listings | Existing Finnhub candle path only | No longer sent to Alpaca US equities; availability depends on source coverage and permissions |

The panel reports its source, symbol and trading date. Taiwan/crypto benchmark-dependent indicators are N/A rather than comparing mismatched sessions to SPY. Unavailable indicators do not vote; rendering does not require all 57 indicators to be valid.

## Adding a market

Add an entry to `lib/markets.ts` with symbols from an exchange that renders in TradingView embeds (open one symbol in a quote widget first). To price and alert on more exchanges, you need a data plan that covers them.
