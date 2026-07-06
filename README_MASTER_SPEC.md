# ApexQuant V6 - Master Specification

## Current Live Folder

ApexQuant V6 lives here:

/var/www/apexquant-v6

Old bot is archived here:

/var/www/apexquant-archive

Do not edit or restore old bot files unless user approves.

---

## Core Rule

No hidden changes.
No sed patches.
No messy old/new/final files.
Every file must be clearly named.
Every update must create a backup first.
Every code section must be clearly labelled.

---

## Trading Safety

Default mode: PAPER ONLY.

Live trading must be locked behind confirmation.

No guaranteed profit claims.

The bot must account for:
- £1 buy fee
- £1 sell fee
- extra sell fee for each partial exit
- spread
- slippage
- weak liquidity

Trading decisions must use NET P&L after fees.

---

## Portfolios

The bot has two separate paper portfolios.

### Scalp Portfolio

Starting balance: £10,000  
Default trade size: £2,000  
Capital usage: up to 100%, editable  
Daily target: £200  
Target is a guide, not a stop.  
After target is reached, bot continues trading but becomes more selective.

### Strategy Portfolio

Starting balance: £10,000  
Default trade size: £2,000  
Capital usage: up to 100%, editable  
Designed for longer holds and larger moves.

### Combined Dashboard

Dashboard must show:

- Scalp pot balance
- Scalp invested amount
- Scalp open P&L
- Scalp realised P&L
- Strategy pot balance
- Strategy invested amount
- Strategy open P&L
- Strategy realised P&L
- Combined balance
- Combined invested amount
- Combined open P&L
- Combined realised P&L

---

## Reinvestment

Each pot has reinvestment settings.

Options:
- 0%
- 25%
- 50%
- 75%
- 100%

Profit source options:
- Scalp profit only
- Strategy profit only
- Both pots
- Shared profit pool

---

## Pause Behaviour

Pause trading means:

1. Stop opening new trades immediately.
2. Continue monitoring current trades.
3. Analyse each open trade.
4. Show whether to hold or sell.
5. Do not auto-sell blindly.

Emergency exits are allowed only when rules are triggered:
- Stop loss hit
- Panic Sell pressed
- Close All pressed
- Max loss breached
- Critical feed/exchange failure

---

## Panic Sell

Every open trade card must have a Panic Sell button.

Panic Sell closes that single trade immediately.

There must also be a Close All button, clearly separated and confirmed.

---

## Bot Brain

Dashboard must include AI Brain Console.

It must show:
- what pair is being checked
- strategy being tested
- confidence
- expected gross profit
- expected fees
- expected net profit
- reason for reject
- reason for entry
- reason for hold
- reason for exit
- BTC regime
- correlation risk
- market condition

User must be able to ask:
- Why did you enter this trade?
- Why did you reject this pair?
- Why are you holding?
- Why are you selling?
- What are you watching next?
- What target are we aiming for?

---

## Pairs Being Reviewed

Dashboard must show a live table:

- Pair
- Pot: Scalp / Strategy
- Current price
- Signal: Long / Short / Hold / Reject
- Strategy checked
- Confidence
- Expected net profit
- Fee check
- Spread check
- Correlation risk
- BTC risk
- Reason
- Last reviewed time

---

## WhatIf Learning Engine

After every closed trade, continue tracking price.

Intervals:
- 1 minute
- 3 minutes
- 5 minutes
- 10 minutes
- 15 minutes
- 20 minutes
- 1 hour
- 4 hours
- 24 hours

Store:
- actual exit price
- price after each interval
- extra profit missed
- extra loss avoided
- best possible exit
- worst possible exit
- whether exit was too early
- whether exit was too late
- strategy used
- market condition
- BTC movement
- volume change
- spread
- fees
- net P&L

This data must improve future trailing stop and exit logic.

---

## Exit Engine

Every trade has:

- hard stop loss
- catastrophic stop
- fee-aware take profit
- adaptive trailing stop
- break-even logic
- optional partial profit taking

Scalp default:
- target net win: £8
- trail activation: £5 net
- profit lock: £3 net
- full take profit: £8-£12 net depending on momentum

Strategy default:
- wider stop
- longer hold
- trailing stop based on trend strength

---

## Market Intelligence

The bot should support external intelligence from:

- Binance WebSocket
- CoinGecko
- Alternative.me Fear & Greed
- CryptoPanic
- Reddit
- X/Twitter later
- Yahoo Finance later
- DXY
- VIX
- gold
- oil
- stock indices
- BTC dominance
- funding/open interest later

External intelligence should score:
- bullish
- bearish
- neutral
- high-risk
- pause new trades
- short-only
- reduce position size

---

## Correlation Engine

The bot must understand linked assets.

Examples:
- BTC affects ETH
- BTC affects SOL
- ETH affects altcoins
- correlated long trades increase hidden risk

If already long BTC, ETH, and SOL, the bot must recognise this may be one combined directional risk.

---

## V6 Folder Structure

/var/www/apexquant-v6
├── backend
│   ├── server.js
│   ├── config
│   ├── engines
│   ├── services
│   ├── routes
│   └── storage
├── frontend
│   └── dashboard.html
├── data
├── logs
├── backups
└── README_MASTER_SPEC.md

---

## Version Rule

Use clean version numbers:

V6.0.0
V6.0.1
V6.1.0

Never use names like:
- final
- final2
- fixed
- newnew
- latest

---

## Next Build Step

Create backend/server.js first.

It must run on port 8091.

Old bot used port 8090.

V6 must not use real money.
