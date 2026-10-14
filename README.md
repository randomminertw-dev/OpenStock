<div align="center">
  <br />
  <a href="#" target="_blank">
    <img src="./public/assets/images/dashboard.png" alt="Project Banner" />
  </a>
  <br />
  <br/>

  <div>
    <img src="https://img.shields.io/badge/-Next.js-black?style=for-the-badge&logoColor=white&logo=next.js&color=000000" alt="Next.js badge" />
    <img src="https://img.shields.io/badge/-TypeScript-black?style=for-the-badge&logoColor=white&logo=typescript&color=3178C6"/>
    <img src="https://img.shields.io/badge/-Tailwind%20CSS-black?style=for-the-badge&logoColor=white&logo=tailwindcss&color=38B2AC"/>
    <img src="https://img.shields.io/badge/-shadcn/ui-black?style=for-the-badge&logoColor=white&logo=shadcnui&color=000000"/>
    <img src="https://img.shields.io/badge/-Better%20Auth-black?style=for-the-badge&logoColor=white&logo=betterauth&color=000000"/>
    <img src="https://img.shields.io/badge/-MongoDB-black?style=for-the-badge&logoColor=white&logo=mongodb&color=00A35C"/>
    <img src="https://img.shields.io/badge/-Finnhub-black?style=for-the-badge&logoColor=white&color=30B27A"/>
    <img src="https://img.shields.io/badge/-Alpaca-black?style=for-the-badge&logoColor=white&color=FF6A00"/>
    <img src="https://img.shields.io/badge/-CoinGecko-black?style=for-the-badge&logoColor=white&color=8DC63F"/>
  </div>
</div>

# RandomInvestigation

RandomInvestigation is an open-source market research platform. Track real-time prices for US stocks and cryptocurrencies, explore 57 technical indicators with disagreement monitoring, and dig into company insights — built openly, for everyone.

> **Fork note:** This project is a modified fork of [OpenStock](https://github.com/Open-Dev-Society/OpenStock) by Open Dev Society, maintained independently. Original copyright belongs to Open Dev Society. This modified version is licensed under AGPL-3.0; if you modify, redistribute, or deploy it (including as a web service), you must release your source code under the same license and credit the original authors.

Note: RandomInvestigation is community-built and not a brokerage. Market data may be delayed based on provider rules and your configuration. Nothing here is financial advice.

## 📋 Table of Contents

1. ✨ [Introduction](#introduction)
2. ⚙️ [Tech Stack](#tech-stack)
3. 🔋 [Features](#features)
4. 🤸 [Quick Start](#quick-start)
5. 🐳 [Docker Setup](#docker-setup)
6. 🔐 [Environment Variables](#environment-variables)
7. 🧱 [Project Structure](#project-structure)
8. 📡 [Data & Integrations](#data--integrations)
9. 🧪 [Scripts & Tooling](#scripts--tooling)
10. 🤝 [Contributing](#contributing)
11. 🛡️ [Security](#security)
12. 📜 [License](#license)
13. 🙏 [Acknowledgements](#acknowledgements)

## ✨ Introduction <a name="introduction"></a>

RandomInvestigation is a modern market app powered by Next.js (App Router), shadcn/ui and Tailwind CSS, Better Auth for authentication, MongoDB for persistence, Finnhub for stock quotes and news, Alpaca for historical candles, CoinGecko for cryptocurrency prices, and TradingView widgets for charts and market views.

## ⚙️ Tech Stack <a name="tech-stack"></a>

Core
- Next.js 15 (App Router), React 19
- TypeScript
- Tailwind CSS v4 (via @tailwindcss/postcss)
- shadcn/ui + Radix UI primitives
- Lucide icons

Auth & Data
- Better Auth (email/password) with MongoDB adapter
- MongoDB + Mongoose
- Finnhub API for stock quotes, symbols, profiles, and market news
- Alpaca API for historical daily candles (indicator engine)
- CoinGecko API for cryptocurrency prices
- TradingView embeddable widgets

Automation & Comms
- Inngest (events, cron, AI inference via Gemini)
- Nodemailer (Gmail transport)
- next-themes, cmdk (command palette), react-hook-form

## 🔋 Features <a name="features"></a>

- Authentication
    - Email/password auth with Better Auth + MongoDB adapter
    - Protected routes enforced via Next.js middleware
- Global search and Command + K palette
    - Fast stock and crypto search (stocks via Finnhub, crypto via CoinGecko)
    - Popular stocks when idle; debounced querying
- Watchlist
    - Per-user watchlist stored in MongoDB (unique symbol per user)
- Stock details
    - 57 technical indicators with voting and IDS disagreement monitoring
    - Four factors (Trend / Momentum / Volume / Volatility Risk)
    - Multi-period exploration (7/14/20/21/28) with manual parameter switching
    - News sentiment card
    - Company profile and financials widgets
- Cryptocurrency
    - Real-time prices via CoinGecko (CG: prefix)
    - Technical indicator analysis via Alpaca crypto bars
- Market overview
    - Heatmap, quotes, and top stories (TradingView widgets)
- Personalized onboarding
    - Collects country, investment goals, risk tolerance, preferred industry
- Email & automation
    - AI-personalized welcome email (Gemini via Inngest)
    - Weekly news summary email (cron)
- Polished UI
    - shadcn/ui components, Radix primitives, Tailwind v4 design tokens
    - Dark theme by default
- Keyboard shortcut
    - Cmd/Ctrl + K for quick actions/search

## 🤸 Quick Start <a name="quick-start"></a>

Prerequisites
- Node.js 20+ and pnpm or npm
- MongoDB connection string (MongoDB Atlas or local via Docker Compose)
- Finnhub API key (free tier supported for quotes and news)
- Alpaca API key + secret (free tier; required for historical candles used by indicators)
- Optional: Gmail account for email (or update Nodemailer transport) if you want welcome and news summary emails
- Optional: Google Gemini API key (for AI-generated welcome intros)

Clone and install
```bash
git clone https://github.com/randomminertw-dev/OpenStock.git
cd OpenStock

# choose one:
pnpm install
# or
npm install
```

Configure environment
- Create a `.env` file (see [Environment Variables](#environment-variables)).
- Verify DB connectivity:
```bash
pnpm test:db
# or
npm run test:db
```

Run development
```bash
# Next.js dev (Turbopack)
pnpm dev
# or
npm run dev
```

Run Inngest locally (workflows, cron, AI)
```bash
npx inngest-cli@latest dev
```

Build & start (production)
```bash
pnpm build && pnpm start
# or
npm run build && npm start
```

Open http://localhost:3000 to view the app.

## 🐳 Docker Setup <a name="docker-setup"></a>

You can run RandomInvestigation and MongoDB easily with Docker Compose.

1) Ensure Docker and Docker Compose are installed.

2) docker-compose.yml includes two services:
- app (this app)
- mongodb (MongoDB database with a persistent volume)

3) Create your `.env` (see examples below). For the Docker setup, use a local connection string like:
```env
MONGODB_URI=mongodb://root:example@mongodb:27017/openstock?authSource=admin
```

4) Start the stack:
```bash
# from the repository root
docker compose up -d mongodb && docker compose up -d --build
```

5) Access the app:
- App: http://localhost:3000
- MongoDB is available inside the Docker network at host mongodb:27017

Notes
- The app service depends_on the mongodb service.
- Credentials are defined in Compose for the MongoDB root user; authSource=admin is required on the connection string for root.
- Data persists across restarts via the docker volume.
- `NODEMAILER_EMAIL` and `NODEMAILER_PASSWORD` are optional for local Docker runs. If they are omitted, the app still starts but email features stay disabled.

## 🔐 Environment Variables <a name="environment-variables"></a>

Create `.env` at the project root. Choose either a hosted MongoDB (Atlas) URI or the local Docker URI.

```env
# Core
NODE_ENV=development

# Database (Atlas)
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority

# Better Auth
BETTER_AUTH_SECRET=your_better_auth_secret
BETTER_AUTH_URL=http://localhost:3000

# Finnhub (stock quotes, symbols, profiles, news)
# Note: NEXT_PUBLIC_FINNHUB_API_KEY is required for Vercel deployment
NEXT_PUBLIC_FINNHUB_API_KEY=your_finnhub_key
FINNHUB_BASE_URL=https://finnhub.io/api/v1
# Several free Finnhub keys, rotated per request: each adds 60 requests/min.
# FINNHUB_API_KEYS=key_one,key_two

# Alpaca (historical daily candles for the indicator engine)
# Free tier at https://alpaca.markets — required for 57-indicator voting and factors
ALPACA_API_KEY=your_alpaca_key
ALPACA_API_SECRET=your_alpaca_secret

# CoinGecko (cryptocurrency prices; free, no key required)
# Optional: COINGECKO_DEMO_API_KEY=your_demo_key (raises rate limits)

# Taiwan Official Market Data & Sync (TWSE / TPEX)
# Rollback flag for daily candles: "official" (default, TWSE/TPEX) or "finmind" (legacy fallback)
TAIWAN_CANDLE_PROVIDER=official

# Background sync flags (defaults to disabled; explicit true required)
TAIWAN_AUTO_SYNC_ENABLED=false
TAIWAN_HISTORY_ENABLED=false

# Optional on-demand budget overrides (set all six together); scheduled/CLI sync requires explicit limits
TAIWAN_MAX_REQUESTS_PER_DAY=200
TAIWAN_MAX_JOBS_PER_DAY=100
TAIWAN_MAX_TRANSFER_BYTES_PER_DAY=104857600
TAIWAN_MAX_STORAGE_BYTES=10485760
TAIWAN_MAX_TRACKED_SECURITIES=20
TAIWAN_MAX_RESPONSE_BYTES=10485760

# FinMind (legacy fallback; Taiwan daily history when TAIWAN_CANDLE_PROVIDER=finmind; sent server-side only)
# Optional: FINMIND_API_TOKEN=your_finmind_token

# Sentiment insights (optional)
ADANOS_API_KEY=your_adanos_api_key
# ADANOS_API_BASE_URL=https://api.adanos.org

# AI Provider (optional, default: "gemini")
# GEMINI_API_KEY=your_gemini_api_key

# Inngest (required for Vercel deployment)
INNGEST_SIGNING_KEY=your_inngest_signing_key
INNGEST_EVENT_KEY=your_inngest_event_key

# Social sign-in (optional; each provider is hidden server-side until set)
# Callback URLs: <BETTER_AUTH_URL>/api/auth/callback/google and /api/auth/callback/github
# GOOGLE_CLIENT_ID=your_google_client_id
# GOOGLE_CLIENT_SECRET=your_google_client_secret
# GITHUB_CLIENT_ID=your_github_client_id
# GITHUB_CLIENT_SECRET=your_github_client_secret

# Email (optional; Nodemailer via Gmail, consider App Passwords if 2FA)
# NODEMAILER_EMAIL=youraddress@gmail.com
# NODEMAILER_PASSWORD=your_gmail_app_password
```

Notes
- Keep private keys server-side whenever possible.
- If using `NEXT_PUBLIC_` variables, remember they are exposed to the browser.
- In production, prefer a dedicated SMTP provider over a personal Gmail.
- If the Nodemailer credentials are omitted, the app still runs but welcome and news summary emails are disabled.
- Do not hardcode secrets in the Dockerfile; use `.env` and Compose.

## 🧱 Project Structure <a name="project-structure"></a>

```
app/
  (auth)/
    layout.tsx
    sign-in/page.tsx
    sign-up/page.tsx
  (root)/
    layout.tsx
    page.tsx
    help/page.tsx
    stocks/[symbol]/page.tsx
  api/inngest/route.ts
  globals.css
  layout.tsx
components/
  ui/…          # shadcn/radix primitives (button, dialog, command, input, etc.)
  forms/…       # InputField, SelectField, CountrySelectField, FooterLink
  stocks/…      # IndicatorDashboard, FactorCards, PeriodExplorer, etc.
  Header.tsx, Footer.tsx, SearchCommand.tsx, WatchlistButton.tsx, …
database/
  models/watchlist.model.ts
  mongoose.ts
lib/
  actions/…     # server actions (auth, finnhub, alpaca, coingecko, indicators, user, watchlist)
  indicators/…  # 57-indicator engine, four factors, multi-period variants, IDS
  better-auth/…
  inngest/…     # client, functions, prompts
  nodemailer/…  # transporter, email templates
  constants.ts, utils.ts
scripts/
  test-db.mjs
types/
  global.d.ts
next.config.ts
postcss.config.mjs      # Tailwind v4 postcss setup
components.json         # shadcn config
public/assets/images/   # logos and screenshots
```

## 📡 Data & Integrations <a name="data--integrations"></a>

- Finnhub
    - Stock quotes, symbol search, company profiles, and market news.
    - Set `NEXT_PUBLIC_FINNHUB_API_KEY` and `FINNHUB_BASE_URL` (default: https://finnhub.io/api/v1).
    - Free tier covers quotes and news; historical candles (`/stock/candle`) require a paid plan.

- Alpaca
    - US stock and `CG:` cryptocurrency daily candles powering technical indicators.
    - Set `ALPACA_API_KEY` and `ALPACA_API_SECRET` (free tier at https://alpaca.markets).
    - US stocks fall back to Finnhub candles when Alpaca is unavailable.

- Binance public market data
    - Crypto-tab pairs such as `BINANCE:BTCUSDT` use `data-api.binance.vision/api/v3/klines` without an API key.
    - Preserves the exact trading pair and excludes unfinished daily candles; does not substitute USD for USDT.

- Taiwan Official Market Data (TWSE & TPEX)
    - Official open data and after-trading APIs for listed (TWSE) and OTC (TPEX) stocks and ETFs.
    - Endpoints:
        - TWSE: `twse-stock-day-all` (daily close snapshot), `STOCK_DAY` (monthly history), `t187ap03_L` / `t187ap47_L` (stock & ETF catalog), `BWIBBU_ALL` (PE/PB/dividend yield), `TWT48U_ALL` (ex-dividend/capital changes), `twse-holiday` (trading calendar).
        - TPEX: `tpex-mainboard-daily-close-quotes` (daily close snapshot), `dailyQuotes` (full-market daily OHLCV batch), `mopsfin_t187ap03_O` / ETF filter (OTC stock & ETF catalog), `tpex_mainboard_peratio_analysis` (PE/PB/yield), `tpex_exright_prepost` (ex-rights).
    - Exact shares volume: Volume represents exact trading shares (`成交股數`), not lots (張) multiplied by 1,000.
    - Price basis & freshness: Unadjusted prices in the Asia/Taipei timezone. OpenAPI snapshots are flagged `complete: false`; verified after-trading historical bars are flagged `complete: true`. No synthetic bars are fabricated for halted or non-trading days.
    - Zero-cost architecture & Free sync quotas: Public endpoints with zero API fees. Network requests, transfer bytes, jobs, and storage are strictly bounded by atomic daily budgets in MongoDB. On-demand reads work automatically with conservative default limits; optional background jobs remain disabled by default (`TAIWAN_AUTO_SYNC_ENABLED=false`, `TAIWAN_HISTORY_ENABLED=false`).
    - Rollback flag: `TAIWAN_CANDLE_PROVIDER=official|finmind` (default: `official`). When set to `finmind`, daily candles and technical indicators fall back to the FinMind provider.
    - TradingView intraday scope: The TradingView embeddable widgets provide intraday chart and quote views (subject to TradingView's available data feeds); the native SVG charts, 57 technical indicators, and four-factor scores use official EOD daily bars stored in MongoDB.

- FinMind (Legacy / Rollback Fallback)
    - Taiwan daily OHLCV from `TaiwanStockPrice` as a transitional fallback provider when `TAIWAN_CANDLE_PROVIDER=finmind`.
    - Accepts `.TW` / `.TWO` and `TWSE:` / `TPEX:` symbols. Prices are unadjusted, end-of-day, in the Taipei trading calendar.
    - Works without a key; optionally set server-only `FINMIND_API_TOKEN` for your account quota. Never use a `NEXT_PUBLIC_` prefix.

- Indicator availability
    - Requests 400 calendar days; needs at least 60 valid candles to render. Longer indicators can still be N/A.
    - Taiwan and crypto do not use the US SPY benchmark: RS, Beta and RRG remain N/A until a suitable comparison series is configured.
    - Successful history is cached for one hour; failures cool down for one minute, with concurrent requests deduplicated per server instance.
    - The panel separates API errors, missing credentials, unsupported symbols, empty history and genuinely short history.
    - Missing volume is retained as an availability flag. If any retained bar lacks volume (or all volume is zero), volume indicators, the V factor and CMF variants are N/A; price indicators still render.
    - Offline regression checks: `npx vitest run lib/actions/alpaca.actions.test.ts lib/actions/candles-routing.test.ts lib/actions/finnhub-candles.test.ts __tests__/market-indicators.test.tsx`.
    - Optional live public-data check: `LIVE_MARKET_DATA=1 npx vitest run __tests__/market-candles.live.test.ts` (uses provider quota; no database required).

- CoinGecko
    - Cryptocurrency search and real-time prices (free, no key required).
    - Crypto symbols use the `CG:` prefix (e.g. `CG:bitcoin`).
    - Optional `COINGECKO_DEMO_API_KEY` raises rate limits.

- TradingView
    - Embeddable widgets used for charts, heatmap, quotes, and timelines.

- Better Auth + MongoDB
    - Email/password with MongoDB adapter.
    - Session validation via middleware; most routes are protected, with public exceptions for `sign-in`, `sign-up`, assets and Next internals.

- Inngest
    - Workflows:
        - `app/user.created` → AI-personalized Welcome Email
        - Cron `0 9 * * 1` → Weekly News Summary (every Monday at 9 AM)
    - Local dev: `npx inngest-cli@latest dev`.

- Email (Nodemailer)
    - Gmail transport. Update credentials or switch to your SMTP provider.
    - Templates for welcome and news summary emails.

## 🧪 Scripts & Tooling <a name="scripts--tooling"></a>

Package scripts
- `dev`: Next.js dev server with Turbopack
- `build`: Production build (Turbopack)
- `start`: Run production server
- `lint`: ESLint
- `test:db`: Validate DB connectivity
- `taiwan:build-sync`: Compile TypeScript CLI entry into `.taiwan-sync/` using `tsc`
- `taiwan:sync`: Taiwan market sync & inspection CLI (dry-run inspection or scoped apply within configured quotas)
  - Dry run inspection: `npm run taiwan:sync -- --dry-run --symbols TWSE:2330,TWSE:0050,TPEX:6488,TPEX:00679B --days 800`
  - Scoped synchronization: `npm run taiwan:sync -- --apply --target production --symbols TWSE:2330,TWSE:0050 --days 800`
  - Supported flags: `--dry-run`, `--apply`, `--target <label>`, `--symbols <list>`, `--days <1-1000>`, `--close`, `--catalog`, `--details`, `--history`

### Automatic Taiwan data loading

Deploy with the website's existing MongoDB configuration. Searching `2330` or `0050` automatically retrieves and caches the official stock/ETF catalog when it is missing; there is no required `--catalog` initialization or extra API key. Opening a Taiwan stock page automatically loads recent confirmed daily bars and applicable stock/fund information. Optional background sync flags can remain false.

Known-code/name lookups first query matching persisted instruments, without downloading the full market catalog or reserving upstream quota. This works across serverless restarts even if history has exhausted its daily allowance. A missing instrument can trigger the existing official bootstrap/refresh; its full-catalog cache lasts 24 hours. Persisted lookup results can be older than this refresh cache and are not represented as newly refreshed. Shared requests and Next.js data caching reduce repeated upstream downloads, and MongoDB stores results for later instances. Failed updates preserve usable cached data. If the shared quota ledger cannot be read, new upstream work pauses instead of allocating a separate per-instance allowance.

Long history progresses two official periods per request. The page polls while visible and refreshes charts/indicators as more bars arrive. Listed history uses monthly periods; OTC history uses daily batches to preserve exact shares and the same trading scope. Progress is stored by period identity so day/month boundaries and serverless restarts do not lose work. Completed history refreshes only recent periods, rather than downloading the whole range again. Current-day bars are conservatively excluded before 18:00 Taipei time; the displayed date always identifies the available completed session.

Default on-demand limits are 200 requests/day, 100 MiB transfer/day, 10 MiB persisted payload/day, 10 MiB per response, and up to 20 cached security histories per instance. Explicit `TAIWAN_MAX_*` overrides replace these defaults when all six are valid positive integers. OTC long history can require several days under these limits: existing data remains usable, and a visible page resumes after the next Taipei day when the quota resets. No paid provider or infrastructure upgrade is added.

The CLI remains an optional prewarming/maintenance tool. It loads Next.js env files before starting its worker; `--target` is a label, not a database selector, and `--target local` is nonpersistent. Preview work without requests or writes:

```bash
npm run taiwan:sync -- --dry-run --catalog --close --details --history --symbols TWSE:2330 --days 800
```

Only use `--apply` for intentional maintenance after confirming the database target and explicit limits. Normal users do not need to run it. Signed-in access is required for on-demand actions that can trigger upstream work. Source failures return readable status data instead of production-redacted Server Action exceptions.

#### Diagnosing Taiwan loading failures on Vercel

`missing-config` is an application status, not an HTTP status returned by TWSE. The current on-demand loader rejects partial/invalid `TAIWAN_MAX_*` overrides and pauses new requests when shared MongoDB quota operations fail. All six overrides must be valid together; omit them all to use the documented defaults. A repository operation taking longer than 1.5 seconds opens a 60-second circuit breaker for that operation only. Failed catalog/cache reads cannot block a healthy quota ledger. Generic database failures and timeouts remain `api-error`, rather than being relabeled as missing configuration.

Filter runtime logs by `[taiwan-data]`: `limits-invalid` lists missing/invalid variable names (never values); `cache-failure` identifies the repository operation, elapsed time, and numeric error code; `cache-blocked` repeats the operation's saved cause/code and remaining cooldown so the first error need not be in the same invocation; `upstream-failure` identifies the official host/path, status, and application reason. Messages, credentials, response bodies, and query parameters are not logged. Check these events before attributing a failed search to upstream rate limiting; browser HTTP 200 can still carry a failed Server Action result. A successful API probe from a developer machine does not prove connectivity from a Vercel runtime.

`budget-limit` without an HTTP status is an application budget rejection, not evidence of an official HTTP rate limit. Searches for persisted instruments bypass that budget. Uncached instruments preserve a `catalog-budget-limit` search result with a daily-budget message; they cannot be fetched until an allowance is available. A full-catalog read failure has a separate circuit from filtered lookups.

Developer experience
- TypeScript strict mode
- Tailwind CSS v4 (no separate tailwind.config needed)
- shadcn/ui components with Radix primitives
- cmdk command palette, next-themes, lucide-react icons
- Vitest for the indicator engine (200+ unit tests)

## 🤝 Contributing <a name="contributing"></a>

Contributions are welcome.

- Open an issue to discuss ideas and bugs
- Keep PRs focused; add screenshots for UI changes
- Run `npx tsc --noEmit` and the Vitest suite before submitting

## 🛡️ Security <a name="security"></a>

If you discover a vulnerability, do not open a public issue. Please contact the maintainer directly and we'll coordinate responsible disclosure.

## 📜 License <a name="license"></a>

This project is a modified fork of [OpenStock](https://github.com/Open-Dev-Society/OpenStock) (© Open Dev Society). It is licensed under the AGPL-3.0 License - see the LICENSE file for details. If you modify, redistribute, or deploy it (including as a web service), you must release your source code under the same license and credit the original authors.

## 🙏 Acknowledgements <a name="acknowledgements"></a>

- [Open Dev Society](https://github.com/Open-Dev-Society) for the original OpenStock project
- Finnhub for accessible market data
- Alpaca for free historical market data
- CoinGecko for free cryptocurrency data
- TradingView for embeddable market widgets
- shadcn/ui, Radix UI, Tailwind CSS, Next.js community
- Inngest for dependable background jobs and workflows
- Better Auth for simple and secure authentication
