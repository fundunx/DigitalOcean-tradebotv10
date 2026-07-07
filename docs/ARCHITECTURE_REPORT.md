# ApexQuant V10 Architecture Report

## Current Status

ApexQuant V10 is currently a paper-only crypto trading platform running on a DigitalOcean Ubuntu server.

The repository is the source of truth and is connected to GitHub through SSH.

Live trading is intentionally disabled and must remain disabled until explicitly approved.

## Current Safety Position

- Mode: paper only
- Live trading: locked
- Real market data: Binance Futures REST
- Open trades: disabled unless engine execution is explicitly called
- Startup trades: disabled
- Fake market prices: removed
- Read-only decision review: enabled
- Compact summary endpoint: enabled
- Capital protection: primary objective

## Runtime Entry Point

The service starts from:

- `src/index.js`

Main startup responsibilities:

1. Load configuration.
2. Validate paper-only mode.
3. Validate live trading lock.
4. Create the engine.
5. Start the Binance REST market feed.
6. Start the HTTP dashboard/API server.
7. Register graceful shutdown handlers.

## API Routes

Current HTTP routes:

- `GET /health`
- `GET /api/state`
- `GET /api/summary`
- `GET /api/decisions/review`
- `GET /api/readiness`
- `GET /api/settings/risk`

### `/api/state`

Full runtime state.

Includes full market objects and may include large candle arrays.

Useful for debugging, but not ideal for dashboard rendering.

### `/api/summary`

Compact dashboard-safe state.

Does not return bulky candle arrays.

Returns candle counts instead.

Recommended for dashboard UI.

### `/api/decisions/review`

Read-only trading analysis.

Important safety behaviour:

- Does not open trades.
- Does not mutate broker state.
- Shows scanner reasoning.
- Shows decision reasoning.
- Shows risk approval/rejection.
- Explains why markets are rejected.

## Trading Engine

Main engine file:

- `src/core/engine.js`

Responsibilities:

- Owns market cache.
- Owns scanner.
- Owns decision engine.
- Owns risk engine.
- Owns paper broker.
- Produces full state.
- Produces compact summary.
- Produces read-only decision reviews.

Important methods:

- `state()`
- `summary()`
- `reviewDecisions()`
- `evaluate()`

### Important Warning

`evaluate()` can still open paper trades if called and risk approves.

It is not currently called at startup.

Before any automated trading loop is enabled, `evaluate()` should be redesigned into a safer execution pipeline with explicit controls, persistence, and audit logging.

## Market Data

Current feed:

- `src/market/binanceRestMarketFeed.js`

Current source:

- Binance Futures REST API

Market data collected:

- Price
- Bid
- Ask
- Spread
- 60 one-minute candles per symbol

Current symbols:

- BTCUSDT
- ETHUSDT
- SOLUSDT

## Market Cache

File:

- `src/market/marketCache.js`

Responsibilities:

- Store latest market snapshots.
- Track update timestamps.
- Return current market state.

Current limitation:

- In-memory only.
- No persistence.
- No historical database.
- No replay capability.

## Strategy Scanner

File:

- `src/strategy/scanner.js`

Supporting analysis:

- `src/strategy/marketAnalysis.js`

Current scanner behaviour:

- Requires real market data.
- Requires valid price.
- Requires bid/ask.
- Requires 60 candles.
- Rejects wide spreads.
- Scores trend, momentum, volume and data quality.
- Requires strong confidence before passing.

Current philosophy:

- Do not force trades.
- Cash is a position.
- Weak setups are rejected.

## Decision Engine

File:

- `src/strategy/decisionEngine.js`

Current decision behaviour:

- Requires scanner pass.
- Requires real market data.
- Requires confidence threshold.
- Requires positive expected value.
- Requires multiple confirming signals.
- Produces explainable rejection reasons.
- Produces alternatives.

## Risk Engine

File:

- `src/risk/riskEngine.js`

Current risk behaviour:

- Rejects unapproved decisions.
- Requires real market data.
- Requires entry reason.
- Requires signal explanation.
- Requires stop loss.
- Requires profit target.
- Requires valid position size.
- Blocks duplicate symbol exposure.
- Blocks max open trade violations.

## Paper Broker

File:

- `src/execution/paperBroker.js`

Current behaviour:

- Tracks paper cash.
- Tracks open trades.
- Tracks closed trades.
- Tracks fees.
- Calculates realised PnL.
- Requires valid live entry price for openings.

Current limitation:

- In-memory only.
- No persisted trade state.
- No crash recovery.
- No mark-to-market unrealised PnL.
- No automated trailing stop execution loop.

## Learning Components

Current files:

- `src/learning/whatIf.js`
- `src/learning/learningAdvisor.js`

Current status:

- Minimal early-stage learning support.
- Not yet institutional grade.
- Not persistent.
- Not yet suitable for adaptive trading.

Future direction:

- Persist every decision.
- Persist every rejected trade.
- Persist every missed opportunity.
- Analyse outcomes after future candles.
- Build market memory and strategy memory.

## Storage

Current storage is minimal.

Known storage-related files may include:

- event store
- JSON file store

Current limitation:

- Runtime state is mostly memory-based.
- Production system needs durable persistence.

Future direction:

- SQLite or PostgreSQL for local production.
- Event-sourced trade/decision journal.
- Replayable market/decision history.
- Audit trail for every action.

## Dashboard

Current dashboard/API is minimal HTTP JSON.

There is not yet a professional UI.

Recommended UI direction:

- Use `/api/summary` for top-level dashboard cards.
- Use `/api/decisions/review` for AI reasoning panels.
- Avoid `/api/state` for normal dashboard rendering because it can contain bulky candle data.

Future UI goals:

- Dark institutional theme.
- Real-time market status.
- Feed health.
- Risk status.
- Capital status.
- Decision reasoning.
- Rejection explanations.
- Trade journal.
- Learning insights.

## Deployment

Current deployment:

- DigitalOcean Ubuntu server
- Node.js app
- Manual `npm start`
- GitHub connected through SSH

Future deployment priorities:

1. Systemd service hardening.
2. Environment file validation.
3. Structured logs.
4. Health checks.
5. CI/CD.
6. Docker.
7. Kubernetes-compatible architecture later.

## Security Review

Current positives:

- Live trading locked.
- Paper-only validation exists.
- No exchange trading keys required for current REST market data.

Current risks:

- No authentication shown for API endpoints.
- Dashboard endpoints may expose sensitive state if publicly reachable.
- No rate limiting on HTTP API.
- No HTTPS enforcement at app level.
- No production auth/session system.

Recommended next security step:

- Put the service behind Nginx with HTTPS and basic auth or token auth.
- Add API auth middleware before exposing dashboard publicly.

## Current Technical Debt

1. `evaluate()` can open paper trades and should not be used until refactored.
2. State is in-memory only.
3. No persistent decision journal.
4. No persistent trade journal.
5. No frontend UI yet.
6. No typed interfaces.
7. No formal service boundaries.
8. Minimal test suite.
9. No CI confirmed on current simplified server branch.
10. No production process manager/systemd confirmation in current runtime.

## Recommended Next Priorities

### Priority 1: Persist Decision Reviews

Every review should be saved.

This should include:

- Timestamp
- Symbol
- Market snapshot summary
- Scanner analysis
- Decision output
- Risk output
- Whether it was rejected
- Why it was rejected

### Priority 2: Build Dashboard UI

Use:

- `/api/summary`
- `/api/decisions/review`
- `/api/readiness`

Do not use bulky `/api/state` for normal dashboard display.

### Priority 3: Harden Runtime

- Systemd service
- Restart policy
- Environment validation
- Log rotation
- API auth
- Nginx reverse proxy

### Priority 4: Improve Market Intelligence

Add:

- Volatility model
- Support/resistance
- Breakout/fakeout detection
- Market regime detection
- BTC dominance/correlation later
- Funding/open interest later

## Final Assessment

The system is now safely past the most dangerous early flaws:

- It no longer creates fake startup trades.
- It uses real Binance market data.
- It rejects weak setups.
- It exposes read-only decision review.
- It provides compact dashboard-safe summary output.
- It remains paper-only and capital-protective.

The next phase should focus on persistence, dashboard clarity, and production hardening before any automated paper execution loop is considered.
