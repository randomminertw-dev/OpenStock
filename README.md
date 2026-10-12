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
    - Historical daily candles powering the 57-indicator voting, four factors, and multi-period exploration.
    - Set `ALPACA_API_KEY` and `ALPACA_API_SECRET` (free tier at https://alpaca.markets).
    - Falls back to Finnhub candles when Alpaca is unavailable.

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
