# Mobile Simple Market

Mobile-first multiplayer crypto trading simulation game with admin-driven teaching events.

## Stack
- `client`: React + Vite + TypeScript + Lightweight Charts
- `server`: Express + Socket.IO + Prisma + SQLite
- `shared`: shared TypeScript types

## Setup
```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:5173`.

## Environment Variables
- `ADMIN_PIN` (required in production): admin gate PIN
- `PORT` (default `3000`): server port
- `NODE_ENV`: `development` or `production`

## Scripts
- `npm run dev` - runs Prisma db push + server/client dev mode
- `npm run build` - builds shared, client, and server
- `npm start` - serves production server + static client build

## Gameplay Flow
1. Join room with username + room code (defaults to `PUBLIC`).
2. Trade market orders (buy/sell) across BTC/ETH/SOL/DOGE.
3. View portfolio balances and PnL.
4. View leaderboard ranked by total equity.
5. Admin tab unlocks with PIN for controls and teaching events.

## Admin Controls
- Set volatility, liquidity, spread, fees, halt, and supply delta.
- Trigger events:
  - Pump / Dump
  - Rug Pull Liquidity
  - Fake Breakout
  - Dilution
  - Whale Candle
  - Fee Hike
  - Spread Widening
  - Trading Halt toggle
  - Wash Trading effect
- Broadcast messages to all players.

## Price Engine (brief)
- Runs per-symbol tick every second.
- Price move = random normal baseline (`volatility`) + drift components:
  - trend bias (event-driven)
  - supply pressure (dilution/deflation)
  - small mean reversion to session open
- Liquidity scales impact and affects slippage/fill quality.
- 5-second OHLC candles are built server-side and streamed via Socket.IO.

## Persistence
SQLite with Prisma stores:
- rooms, users, positions, trades, events, leaderboard snapshots.

## Render Deployment (single service)
This repo includes `render.yaml` for one free-tier web service.

### Deploy steps
1. Push repo to GitHub.
2. In Render: **New + > Blueprint** and select repo.
3. Set secret `ADMIN_PIN` in Render dashboard.
4. Deploy.

The server will serve built client assets in production.
