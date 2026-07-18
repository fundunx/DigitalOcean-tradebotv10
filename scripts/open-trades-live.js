#!/usr/bin/env node

const BOT_API = process.env.APEX_API || 'http://localhost:3000';
const BINANCE_API = 'https://fapi.binance.com';
const DEFAULT_TRADE_SIZE = Number(process.env.TRADE_SIZE_GBP || process.env.PAPER_FIXED_TRADE_SIZE_GBP || 2000);

function money(n) {
  n = Number(n) || 0;
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

function rawMoney(n) {
  return `£${(Number(n) || 0).toFixed(2)}`;
}

function percent(n) {
  n = Number(n) || 0;
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}${Math.abs(n).toFixed(3)}%`;
}

function padRight(v, n) {
  return String(v).padEnd(n);
}

function padLeft(v, n) {
  return String(v).padStart(n);
}

function parseTime(value) {
  if (!value) return null;

  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function age(trade) {
  const opened =
    parseTime(trade.openedAt) ||
    parseTime(trade.openTime) ||
    parseTime(trade.entryTime) ||
    parseTime(trade.createdAt) ||
    parseTime(trade.ts) ||
    parseTime(trade.timestamp);

  if (!opened) return '-';

  const mins = Math.floor(Math.max(0, Date.now() - opened) / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;

  return h ? `${h}h ${m}m` : `${m}m`;
}

function symbolOf(trade) {
  return String(trade.symbol || trade.market || trade.pair || '').toUpperCase();
}

function sideOf(trade) {
  return String(trade.side || trade.direction || 'long').toLowerCase();
}

function modeOf(trade) {
  return String(trade.potName || trade.mode || trade.strategyMode || trade.bucket || 'strategy').toUpperCase();
}

function confidenceOf(trade) {
  const raw =
    Number(trade.confidence) ||
    Number(trade.confidenceScore) ||
    Number(trade.score) ||
    0;

  if (raw > 1) return raw;
  return raw * 100;
}

function entryPriceOf(trade) {
  return (
    Number(trade.entryPrice) ||
    Number(trade.openPrice) ||
    Number(trade.price) ||
    Number(trade.fillPrice) ||
    Number(trade.requestedPrice) ||
    0
  );
}

function sizeOf(trade) {
  const direct =
    Number(trade.size) ||
    Number(trade.sizeGbp) ||
    Number(trade.positionSizeGbp) ||
    Number(trade.notional) ||
    Number(trade.notionalGbp) ||
    Number(trade.exposure) ||
    Number(trade.amountGbp) ||
    0;

  if (direct > 0) return direct;

  return DEFAULT_TRADE_SIZE;
}

function reasonOf(trade) {
  return String(
    trade.entryReason ||
    trade.reason ||
    trade.signal ||
    trade.notes ||
    '-'
  );
}

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(`${res.status} ${url} ${text.slice(0, 200)}`);
  }

  return JSON.parse(text);
}

async function fetchPrice(symbol) {
  const url = `${BINANCE_API}/fapi/v1/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const data = await getJson(url);
  return Number(data.price) || 0;
}

function getOpenTrades(state) {
  if (Array.isArray(state.openTrades) && state.openTrades.length) {
    return state.openTrades;
  }

  const trades = [];

  if (state.portfolios?.scalp?.openTrades) {
    trades.push(...state.portfolios.scalp.openTrades);
  }

  if (state.portfolios?.strategy?.openTrades) {
    trades.push(...state.portfolios.strategy.openTrades);
  }

  if (state.portfolios?.scalp?.positions) {
    trades.push(...state.portfolios.scalp.positions);
  }

  if (state.portfolios?.strategy?.positions) {
    trades.push(...state.portfolios.strategy.positions);
  }

  return trades;
}

async function main() {
  const state = await getJson(`${BOT_API}/api/state`);
  const trades = getOpenTrades(state);

  const symbols = [...new Set(trades.map(symbolOf).filter(Boolean))];
  const prices = {};

  for (const symbol of symbols) {
    try {
      prices[symbol] = await fetchPrice(symbol);
    } catch (err) {
      prices[symbol] = null;
    }
  }

  console.clear();
  console.log('APEXQUANT LIVE OPEN PAPER TRADES');
  console.log('================================');
  console.log('Time:          ', new Date().toISOString());
  console.log('Open trades:   ', trades.length);
  console.log('Fallback size: ', rawMoney(DEFAULT_TRADE_SIZE));
  console.log('Bot API:       ', BOT_API);
  console.log('');

  if (!trades.length) {
    console.log('NO OPEN TRADES FOUND');
    return;
  }

  console.log(
    [
      padRight('MODE', 10),
      padRight('SYMBOL', 16),
      padRight('SIDE', 7),
      padRight('AGE', 8),
      padLeft('SIZE', 12),
      padLeft('ENTRY', 14),
      padLeft('LIVE', 14),
      padLeft('PNL', 12),
      padLeft('PNL %', 10),
      padLeft('CONF', 8),
      padRight('PRICE', 8),
      'REASON',
    ].join(' ')
  );

  console.log('-'.repeat(150));

  let totalExposure = 0;
  let totalPnl = 0;
  let missingPrices = 0;

  for (const trade of trades) {
    const symbol = symbolOf(trade);
    const side = sideOf(trade);
    const direction = side === 'short' ? -1 : 1;
    const entry = entryPriceOf(trade);
    const live = prices[symbol];
    const size = sizeOf(trade);

    let pnlPct = 0;
    let pnl = 0;
    let priceStatus = 'LIVE';

    if (!live || !entry || !size) {
      missingPrices += 1;
      priceStatus = 'MISSING';
    } else {
      pnlPct = ((live - entry) / entry) * direction * 100;
      pnl = size * (pnlPct / 100);
    }

    totalExposure += size;
    totalPnl += pnl;

    console.log(
      [
        padRight(modeOf(trade), 10),
        padRight(symbol, 16),
        padRight(side.toUpperCase(), 7),
        padRight(age(trade), 8),
        padLeft(rawMoney(size), 12),
        padLeft(entry ? entry.toFixed(8) : 'NO ENTRY', 14),
        padLeft(live ? live.toFixed(8) : 'NO PRICE', 14),
        padLeft(money(pnl), 12),
        padLeft(percent(pnlPct), 10),
        padLeft(confidenceOf(trade).toFixed(1), 8),
        padRight(priceStatus, 8),
        reasonOf(trade).slice(0, 60),
      ].join(' ')
    );
  }

  console.log('-'.repeat(150));
  console.log('TOTAL EXPOSURE:', rawMoney(totalExposure));
  console.log('TOTAL OPEN PNL:', money(totalPnl));
  console.log('MISSING PRICES:', missingPrices);
  console.log('');

  console.log('IMPORTANT');
  console.log('---------');
  console.log('If SIZE was missing from the bot API, this script uses the fixed test size fallback.');
  console.log(`Fallback size currently: ${rawMoney(DEFAULT_TRADE_SIZE)} per trade.`);
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('FAILED:', err.message);
  console.error('');
  process.exit(1);
});
