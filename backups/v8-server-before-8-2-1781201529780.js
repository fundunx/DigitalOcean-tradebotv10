/*
==================================================
APEXQUANT V8
FILE: backend/server-v8.js
VERSION: 8.0.0
PORT: 8095
MODE: PAPER TRADING ONLY

PURPOSE:
Clean backend rewrite with real candle engine.
No live money.
Real Binance WebSocket prices.
Scalp uses 1m / 3m / 5m / 15m candles.
Strategy mode preserved conceptually.
==================================================
*/

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const APP_VERSION = "8.1.0";
const PORT = 8095;
const ROOT = "/var/www/apexquant-v6";
const DATA_DIR = path.join(ROOT, "data");
const LOG_DIR = path.join(ROOT, "logs");
const STATE_FILE = path.join(DATA_DIR, "state-v8.json");
const PAPER_MODE_ONLY = true;
const GBP_USD_RATE = 0.785;

for (const dir of [DATA_DIR, LOG_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const PAIRS = [
  "BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","AVAXUSDT","DOTUSDT","TRXUSDT",
  "LINKUSDT","LTCUSDT","UNIUSDT","NEARUSDT","APTUSDT","ATOMUSDT","ETCUSDT","ICPUSDT","FILUSDT","XLMUSDT",
  "ARBUSDT","OPUSDT","SUIUSDT","IMXUSDT","GRTUSDT","STXUSDT","INJUSDT","ALGOUSDT","SEIUSDT","TIAUSDT",
  "PEPEUSDT","FETUSDT","RUNEUSDT","PYTHUSDT","JUPUSDT","WIFUSDT","WLDUSDT","AAVEUSDT","LDOUSDT","SANDUSDT",
  "MANAUSDT","FLOWUSDT","DYDXUSDT","ORDIUSDT","ARKMUSDT","BCHUSDT"
];

const DEFAULT_SETTINGS = {
  paperMode: true,
  liveModeLocked: true,
  pairMode: "TOP_50",
  customPairs: [],
  buyFeeGbp: 1,
  sellFeeGbp: 1,
  slippageAllowancePercent: 0.05,

  engines: {
    scalpEnabled: true,
    strategyEnabled: true
  },

  scalp: {
    startingBalanceGbp: 10000,
    tradeSizeGbp: 2000,
    maxOpenTrades: 5,
    dailyTargetGbp: 200,
    minimumNetProfitGbp: 6,
    idealNetProfitGbp: 8,
    maxQuickWinGbp: 12,
    normalMaxLossGbp: 8,
    highConfidenceMaxLossGbp: 12,
    trailActivationNetGbp: 4,
    trueProfitLockGbp: 1.5,
    minConfidence: 70,
    allowLong: true,
    allowShort: true
  },

  strategy: {
    startingBalanceGbp: 10000,
    tradeSizeGbp: 2000,
    maxOpenTrades: 5,
    dailyTargetGbp: 200,
    targetNetProfitGbp: 30,
    minimumNetProfitGbp: 10,
    trailActivationNetGbp: 20,
    profitLockNetGbp: 10,
    maxLossPerTradePercent: 2,
    allowLong: true,
    allowShort: true
  },

  reinvestment: {
    source: "SEPARATE_POTS",
    scalpReinvestPercent: 50,
    strategyReinvestPercent: 50
  }
};

function portfolio(id, balance) {
  return {
    id,
    name: id === "scalp" ? "Scalp Pot" : "Strategy Pot",
    startingBalanceGbp: balance,
    availableBalanceGbp: balance,
    investedAmountGbp: 0,
    realisedPnlGbp: 0,
    openPnlGbp: 0,
    totalValueGbp: balance,
    openTrades: [],
    closedTrades: [],
    dailyPnlGbp: 0,
    dailyTrades: 0
  };
}

let state = null;

function freshState() {
  return {
    version: APP_VERSION,
    engine: { running: false, paused: true, mode: "PAPER", reason: "V8 paused" },
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    market: { feedStatus: "starting", websocketConnected: false, lastPriceUpdate: null, messageCount: 0 },
    prices: {},
    orderBooks: {},
    candles: {},
    portfolios: {
      scalp: portfolio("scalp", 10000),
      strategy: portfolio("strategy", 10000)
    },
    reviewedPairs: [],
    brain: [],
    trades: [],
    whatIf: [],
    scalpSafety: {
      pairCooldownUntil: {},
      pairLossesToday: {},
      consecutiveLosses: 0
    }
  };
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    state.version = APP_VERSION;

    if (!state.orderBooks) state.orderBooks = {};
    if (!state.candles) state.candles = {};
    if (!state.prices) state.prices = {};

    return;
  }
  state = freshState();
  saveState();
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function brain(type, message, extra = {}) {
  const row = { time: new Date().toISOString(), type, message, ...extra };
  state.brain.unshift(row);
  state.brain = state.brain.slice(0, 300);
  console.log(`[BRAIN V8] ${type}: ${message}`);
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function fees(exitCount = 1) {
  return state.settings.buyFeeGbp + state.settings.sellFeeGbp * exitCount;
}

function money(n) {
  return `£${round2(n).toFixed(2)}`;
}

function activePairs() {
  if (state.settings.pairMode === "TOP_10") return PAIRS.slice(0, 10);
  if (state.settings.pairMode === "TOP_20") return PAIRS.slice(0, 20);
  if (state.settings.pairMode === "CUSTOM" && state.settings.customPairs?.length) return state.settings.customPairs;
  return PAIRS;
}

/*
==================================================
REAL CANDLE ENGINE
==================================================
*/

const TF = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000
};

function bucket(ms, tf) {
  return Math.floor(ms / TF[tf]) * TF[tf];
}

function ensureCandles(symbol) {
  if (!state.candles[symbol]) state.candles[symbol] = {};
  for (const tf of Object.keys(TF)) {
    if (!state.candles[symbol][tf]) state.candles[symbol][tf] = [];
  }
}

function updateCandles(symbol, price, volume) {
  ensureCandles(symbol);
  const now = Date.now();

  for (const tf of Object.keys(TF)) {
    const b = bucket(now, tf);
    const list = state.candles[symbol][tf];
    let c = list[list.length - 1];

    if (!c || c.start !== b) {
      if (c) c.closed = true;
      c = {
        start: b,
        end: b + TF[tf],
        open: price,
        high: price,
        low: price,
        close: price,
        volume: Number(volume || 0),
        trades: 1,
        closed: false
      };
      list.push(c);
      state.candles[symbol][tf] = list.slice(-300);
    } else {
      c.high = Math.max(c.high, price);
      c.low = Math.min(c.low, price);
      c.close = price;
      c.volume += Number(volume || 0);
      c.trades += 1;
    }
  }
}

function candles(symbol, tf = "1m", limit = 50) {
  ensureCandles(symbol);
  return state.candles[symbol][tf].slice(-limit);
}

function green(c) { return c.close > c.open; }
function red(c) { return c.close < c.open; }
function body(c) { return Math.abs(c.close - c.open); }
function range(c) { return Math.max(0.00000001, c.high - c.low); }
function upperWick(c) { return c.high - Math.max(c.open, c.close); }
function lowerWick(c) { return Math.min(c.open, c.close) - c.low; }

function candleMomentum(symbol, tf, count) {
  const cs = candles(symbol, tf, count + 1);
  if (cs.length < count + 1) return 0;
  return ((cs[cs.length - 1].close - cs[0].open) / cs[0].open) * 100;
}

function candleVolatility(symbol, tf, count) {
  const cs = candles(symbol, tf, count);
  if (cs.length < 5) return 0;
  const values = cs.map(c => ((c.high - c.low) / c.close) * 100);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function candleSR(symbol, tf = "5m", count = 30) {
  const cs = candles(symbol, tf, count);
  if (cs.length < 5) return { support: null, resistance: null };
  return {
    support: Math.min(...cs.map(c => c.low)),
    resistance: Math.max(...cs.map(c => c.high))
  };
}

function volumeSpike(symbol, tf = "1m", count = 20) {
  const cs = candles(symbol, tf, count);
  if (cs.length < 6) return false;
  const last = cs[cs.length - 1];
  const prev = cs.slice(0, -1);
  const avg = prev.reduce((s, c) => s + c.volume, 0) / prev.length;
  return avg > 0 && last.volume > avg * 1.5;
}

function detectPattern(symbol) {
  const one = candles(symbol, "1m", 5);
  const five = candles(symbol, "5m", 12);

  if (one.length < 3 || five.length < 5) {
    return { direction: "NONE", score: 0, notes: ["building candles"] };
  }

  const a = one[one.length - 3];
  const b = one[one.length - 2];
  const c = one[one.length - 1];

  let long = 0;
  let short = 0;
  const notes = [];

  if (green(a) && green(b) && green(c)) {
    long += 18;
    notes.push("three green 1m candles");
  }

  if (red(a) && red(b) && red(c)) {
    short += 18;
    notes.push("three red 1m candles");
  }

  if (red(b) && green(c) && c.close > b.open) {
    long += 16;
    notes.push("bullish engulf/reclaim");
  }

  if (green(b) && red(c) && c.close < b.open) {
    short += 16;
    notes.push("bearish engulf/reclaim");
  }

  if (lowerWick(c) > body(c) * 1.5 && green(c)) {
    long += 14;
    notes.push("lower wick rejection");
  }

  if (upperWick(c) > body(c) * 1.5 && red(c)) {
    short += 14;
    notes.push("upper wick rejection");
  }

  const prev5 = five.slice(0, -1);
  const high5 = Math.max(...prev5.map(x => x.high));
  const low5 = Math.min(...prev5.map(x => x.low));

  if (c.close > high5) {
    long += 20;
    notes.push("breakout above 5m high");
  }

  if (c.close < low5) {
    short += 20;
    notes.push("breakdown below 5m low");
  }

  if (volumeSpike(symbol, "1m")) {
    if (long > short) long += 12;
    if (short > long) short += 12;
    notes.push("volume spike");
  }

  const direction = long > short ? "LONG" : short > long ? "SHORT" : "NONE";
  return { direction, score: Math.max(long, short), longScore: long, shortScore: short, notes };
}

function btcRegime() {
  const m5 = candleMomentum("BTCUSDT", "5m", 3);
  const m15 = candleMomentum("BTCUSDT", "15m", 2);
  if (m5 < -0.25 && m15 < 0) return "BTC_RISK_OFF";
  if (m5 > 0.25 && m15 > 0) return "BTC_BULLISH";
  if (m5 < 0) return "BTC_WEAK";
  if (Math.abs(m5) < 0.05) return "BTC_CHOP";
  return "BTC_NEUTRAL";
}

function expectedNet(symbol, pot) {
  const size = state.settings[pot].tradeSizeGbp;
  const v = candleVolatility(symbol, pot === "scalp" ? "1m" : "5m", 20);
  const m = Math.abs(candleMomentum(symbol, pot === "scalp" ? "1m" : "5m", 3));
  const move = pot === "scalp"
    ? Math.max(0.3, v * 2.2 + m * 1.5)
    : Math.max(0.7, v * 2.0 + m);
  return round2(size * (move / 100) - fees());
}

/*
==================================================
WHATIF
==================================================
*/

function createWhatIf(trade) {
  state.whatIf.unshift({
    id: `WI_${Date.now()}`,
    tradeId: trade.id,
    symbol: trade.symbol,
    pot: trade.pot,
    side: trade.side,
    entryPrice: trade.entryPrice,
    actualExitPrice: trade.exitPrice,
    actualNetPnlGbp: trade.pnl.netGbp,
    closeTime: Date.now(),
    intervals: {},
    lesson: "tracking",
    optimalDifferenceGbp: 0
  });
  state.whatIf = state.whatIf.slice(0, 500);
}

function learningFor(symbol, pot) {
  const rows = state.whatIf.filter(w => w.symbol === symbol && w.pot === pot).slice(0, 20);
  if (!rows.length) return { bias: "NEUTRAL", confidenceBoost: 0, targetAdjustGbp: 0, message: "No WhatIf yet" };

  const avg = rows.reduce((s, w) => s + Number(w.optimalDifferenceGbp || 0), 0) / rows.length;

  if (avg > 5) return { bias: "HOLD_WINNERS_ONLY", confidenceBoost: 3, targetAdjustGbp: 2, message: `WhatIf says winners may run further ${money(avg)}` };
  if (avg < -5) return { bias: "TAKE_FASTER", confidenceBoost: 2, targetAdjustGbp: -1, message: `WhatIf says fast exits protected ${money(Math.abs(avg))}` };
  return { bias: "NEUTRAL", confidenceBoost: 0, targetAdjustGbp: 0, message: `WhatIf mixed ${money(avg)}` };
}



/*
==================================================
ORDER BOOK / BID ASK HELPERS
==================================================
*/

function orderBook(symbol) {
  return state.orderBooks?.[symbol] || null;
}

function spreadOk(symbol, maxSpreadPercent = 0.12) {
  const ob = orderBook(symbol);
  if (!ob) return { ok: false, reason: "No bid/ask yet", spreadPercent: 999 };

  if (ob.spreadPercent > maxSpreadPercent) {
    return {
      ok: false,
      reason: "Spread too wide " + round2(ob.spreadPercent) + "%",
      spreadPercent: ob.spreadPercent
    };
  }

  return {
    ok: true,
    reason: "Spread ok " + round2(ob.spreadPercent) + "%",
    spreadPercent: ob.spreadPercent
  };
}

function executionPrice(symbol, side) {
  const ob = orderBook(symbol);
  if (!ob) return state.prices[symbol]?.price || null;

  // LONG buys at ask. SHORT enters at bid.
  return side === "LONG" ? ob.ask : ob.bid;
}

function btcMasterRegime() {
  const m5 = candleMomentum("BTCUSDT", "5m", 3);
  const m15 = candleMomentum("BTCUSDT", "15m", 3);
  const m1 = candleMomentum("BTCUSDT", "1m", 5);

  if (m5 > 0.12 && m15 > 0) return "BULLISH";
  if (m5 < -0.12 && m15 < 0) return "BEARISH";
  if (Math.abs(m5) < 0.05 && Math.abs(m1) < 0.05) return "CHOP";
  return "MIXED";
}

function strategyScore(symbol) {
  const p = state.prices[symbol];
  if (!p) return { signal: "HOLD", score: 0, notes: ["no price"] };

  const price = p.price;
  const sr5 = candleSR(symbol, "5m", 30);
  const sr15 = candleSR(symbol, "15m", 20);

  const m1 = candleMomentum(symbol, "1m", 5);
  const m5 = candleMomentum(symbol, "5m", 3);
  const m15 = candleMomentum(symbol, "15m", 3);
  const vol5 = candleVolatility(symbol, "5m", 20);

  const btc = btcMasterRegime();
  const sp = spreadOk(symbol, 0.12);

  let long = 0;
  let short = 0;
  const notes = [];

  // Candle trend alignment
  if (m5 > 0.08) { long += 15; notes.push("5m trend up"); }
  if (m15 > 0.04) { long += 18; notes.push("15m trend up"); }
  if (m1 > 0.03) { long += 8; notes.push("1m supports long"); }

  if (m5 < -0.08) { short += 15; notes.push("5m trend down"); }
  if (m15 < -0.04) { short += 18; notes.push("15m trend down"); }
  if (m1 < -0.03) { short += 8; notes.push("1m supports short"); }

  // Support/resistance context
  if (sr5.support && price <= sr5.support * 1.008) {
    long += 15;
    notes.push("near 5m support");
  }

  if (sr5.resistance && price >= sr5.resistance * 0.992) {
    short += 15;
    notes.push("near 5m resistance");
  }

  if (sr15.support && price <= sr15.support * 1.012) {
    long += 10;
    notes.push("near 15m support");
  }

  if (sr15.resistance && price >= sr15.resistance * 0.988) {
    short += 10;
    notes.push("near 15m resistance");
  }

  // Breakout / breakdown
  if (sr5.resistance && price > sr5.resistance) {
    long += 18;
    notes.push("breakout above 5m resistance");
  }

  if (sr5.support && price < sr5.support) {
    short += 18;
    notes.push("breakdown below 5m support");
  }

  // BTC regime filter
  if (btc === "BULLISH") {
    long += 12;
    short -= 8;
    notes.push("BTC master bullish");
  }

  if (btc === "BEARISH") {
    short += 12;
    long -= 8;
    notes.push("BTC master bearish");
  }

  if (btc === "CHOP") {
    long -= 12;
    short -= 12;
    notes.push("BTC chop - lower conviction");
  }

  // Volatility must be enough to justify strategy trade.
  if (vol5 < 0.03) {
    long -= 8;
    short -= 8;
    notes.push("low 5m volatility");
  }

  // Spread penalty
  if (!sp.ok) {
    long -= 20;
    short -= 20;
    notes.push(sp.reason);
  } else {
    long += 5;
    short += 5;
    notes.push(sp.reason);
  }

  const signal = long >= short ? "LONG" : "SHORT";
  const score = Math.max(long, short);

  return {
    signal,
    score,
    longScore: long,
    shortScore: short,
    confidence: Math.max(0, Math.min(95, Math.round(score))),
    notes,
    btc,
    spreadPercent: sp.spreadPercent,
    support: sr5.support,
    resistance: sr5.resistance,
    m1,
    m5,
    m15,
    vol5
  };
}

/*
==================================================
SCALP + STRATEGY BRAINS
==================================================
*/

function review(symbol, pot, signal, reason, confidence, extra = {}) {
  return {
    id: `${pot}_${symbol}`,
    time: new Date().toISOString(),
    symbol,
    pot,
    signal,
    reason,
    confidence,
    ...extra
  };
}

function evaluateScalp(symbol) {
  const p = state.prices[symbol];
  if (!p) return review(symbol, "scalp", "WAIT", "No price yet", 0);

  const pattern = detectPattern(symbol);
  const sr = candleSR(symbol, "5m", 30);
  const btc = btcRegime();
  const learn = learningFor(symbol, "scalp");

  let signal = pattern.direction;
  let score = pattern.score;
  const notes = [...pattern.notes];

  const m1 = candleMomentum(symbol, "1m", 3);
  const m3 = candleMomentum(symbol, "3m", 3);
  const m5 = candleMomentum(symbol, "5m", 3);

  if (signal === "LONG" && m1 > 0 && m3 > 0) {
    score += 15;
    notes.push("1m and 3m agree long");
  }

  if (signal === "SHORT" && m1 < 0 && m3 < 0) {
    score += 15;
    notes.push("1m and 3m agree short");
  }

  if (signal === "LONG" && btc === "BTC_BULLISH") {
    score += 8;
    notes.push("BTC supports long");
  }

  if (signal === "SHORT" && (btc === "BTC_WEAK" || btc === "BTC_RISK_OFF")) {
    score += 8;
    notes.push("BTC supports short");
  }

  if (btc === "BTC_CHOP") {
    score -= 5;
    notes.push("BTC choppy");
  }

  const ex = expectedNet(symbol, "scalp");
  let confidence = Math.max(0, Math.min(95, Math.round(45 + score + learn.confidenceBoost)));
  let reason = `Candle scalp ${signal}: ${notes.join(", ")}; ${learn.message}`;

  if (!state.settings.engines.scalpEnabled) {
    signal = "HOLD";
    confidence = 0;
    reason = "Scalp disabled";
  }

  if (signal === "NONE") {
    signal = "HOLD";
    confidence = 40;
    reason = `No candle pattern yet: ${notes.join(", ")}`;
  }

  if (score < 35) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = `Candle score too low ${score}: ${notes.join(", ")}`;
  }

  if (ex < state.settings.scalp.minimumNetProfitGbp) {
    signal = "REJECT";
    confidence = Math.min(confidence, 50);
    reason = `Expected ${money(ex)} below minimum ${money(state.settings.scalp.minimumNetProfitGbp)}`;
  }

  const data = review(symbol, "scalp", signal, reason, confidence, {
    price: p.price,
    strategy: "V8 Candle Scalp",
    expectedNetGbp: ex,
    support: sr.support,
    resistance: sr.resistance,
    btcRegime: btc,
    momentum1m: round2(m1),
    momentum3m: round2(m3),
    momentum5m: round2(m5),
    candlePattern: pattern.direction,
    candleScore: score,
    patternNotes: notes,
    learningAppliedMessage: learn.message
  });

  const risk = canOpenTrade("scalp", data);
  data.canBuy = risk.ok;
  data.whyNotBuying = risk.reason;
  return data;
}

function evaluateStrategy(symbol) {
  const p = state.prices[symbol];
  if (!p) return review(symbol, "strategy", "WAIT", "No price yet", 0);

  const s = strategyScore(symbol);
  const ex = expectedNet(symbol, "strategy");

  let signal = s.signal;
  let confidence = s.confidence;
  let reason = "V8.1 strategy " + signal + ": " + s.notes.join(", ");

  if (!state.settings.engines.strategyEnabled) {
    signal = "HOLD";
    confidence = 0;
    reason = "Strategy disabled";
  }

  // Do not allow weak generic LONG/SHORT spam.
  if (s.score < 58 || ex < 30) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = "Strategy score/expected too low. Score " + s.score + ", expected " + money(ex) + ": " + s.notes.join(", ");
  }

  // Hard BTC master filter.
  if (s.btc === "BULLISH" && signal === "SHORT") {
    signal = "REJECT";
    confidence = 35;
    reason = "Short blocked because BTC master regime is bullish";
  }

  if (s.btc === "BEARISH" && signal === "LONG") {
    signal = "REJECT";
    confidence = 35;
    reason = "Long blocked because BTC master regime is bearish";
  }

  if (s.btc === "CHOP") {
    signal = "HOLD";
    confidence = Math.min(confidence, 55);
    reason = "Holding because BTC master regime is choppy";
  }

  const data = review(symbol, "strategy", signal, reason, confidence, {
    price: p.price,
    strategy: "V8.1 Candle Strategy + Bid/Ask",
    expectedNetGbp: ex,
    support: s.support,
    resistance: s.resistance,
    btcRegime: s.btc,
    spreadPercent: round2(s.spreadPercent),
    strategyScore: s.score,
    longScore: s.longScore,
    shortScore: s.shortScore,
    momentum1m: round2(s.m1),
    momentum5m: round2(s.m5),
    momentum15m: round2(s.m15),
    volatility5m: round2(s.vol5)
  });

  const risk = canOpenTrade("strategy", data);
  data.canBuy = risk.ok;
  data.whyNotBuying = risk.reason;
  return data;
}
/*
==================================================
RISK + TRADE ENGINE
==================================================
*/

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function pairLossKey(symbol) {
  return `${todayKey()}_${symbol}`;
}

function canOpenTrade(pot, r) {
  if (!state.engine.running) return { ok: false, reason: "Engine stopped" };
  if (state.engine.paused) return { ok: false, reason: "Paused" };
  if (!["LONG", "SHORT"].includes(r.signal)) return { ok: false, reason: `Signal is ${r.signal}` };

  const pf = state.portfolios[pot];
  const set = state.settings[pot];
  recalc(pf);

  if (pf.openTrades.some(t => t.symbol === r.symbol)) return { ok: false, reason: "Already open on this pair" };
  if (pf.openTrades.length >= set.maxOpenTrades) return { ok: false, reason: `${pot} max trades reached` };
  if (pf.availableBalanceGbp < set.tradeSizeGbp) return { ok: false, reason: `${pot} balance too low` };

  if (pot === "scalp") {
    const cooldown = state.scalpSafety.pairCooldownUntil[r.symbol] || 0;
    if (Date.now() < cooldown) return { ok: false, reason: "Pair cooldown active" };
    if (r.confidence < state.settings.scalp.minConfidence) return { ok: false, reason: `Confidence ${r.confidence} below ${state.settings.scalp.minConfidence}` };
    if (r.expectedNetGbp < state.settings.scalp.minimumNetProfitGbp) return { ok: false, reason: "Expected net too low" };
  }

  if (pot === "strategy" && r.confidence < 70) return { ok: false, reason: "Strategy confidence too low" };

  return { ok: true, reason: "Risk passed" };
}

function priceForNet(trade, targetNet) {
  const units = trade.sizeGbp / trade.entryPrice;
  const grossNeededGbp = targetNet + fees();
  const grossNeededUsd = grossNeededGbp / GBP_USD_RATE;
  const move = grossNeededUsd / units;
  return trade.side === "LONG" ? trade.entryPrice + move : trade.entryPrice - move;
}

function pnl(trade, price) {
  const dir = trade.side === "LONG" ? 1 : -1;
  const units = trade.sizeGbp / trade.entryPrice;
  const grossUsd = (price - trade.entryPrice) * dir * units;
  const grossGbp = grossUsd * GBP_USD_RATE;
  return { grossGbp: round2(grossGbp), feesGbp: fees(), netGbp: round2(grossGbp - fees()) };
}

function openTrade(pot, r) {
  const pf = state.portfolios[pot];
  const set = state.settings[pot];
  const price = executionPrice(r.symbol, r.signal);
  if (!price) return null;

  const stopLossNetGbp = pot === "scalp"
    ? -(r.confidence >= 88 ? set.highConfidenceMaxLossGbp : set.normalMaxLossGbp)
    : -(set.tradeSizeGbp * (set.maxLossPerTradePercent / 100));

  const trade = {
    id: `T_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pot,
    symbol: r.symbol,
    side: r.signal,
    strategy: r.strategy,
    entryTime: new Date().toISOString(),
    entryMs: Date.now(),
    entryPrice: price,
    currentPrice: price,
    sizeGbp: set.tradeSizeGbp,
    status: "OPEN",
    confidence: r.confidence,
    reasonEntry: r.reason,
    stopLossNetGbp,
    targetNetGbp: pot === "scalp" ? set.idealNetProfitGbp : set.targetNetProfitGbp,
    peakNetPnlGbp: -fees(),
    lockedProfitGbp: 0,
    trailingStopPrice: null,
    whatIfUsed: r.learningAppliedMessage || "",
    botThinking: "Opened from V8 candle engine",
    pnl: { grossGbp: 0, feesGbp: fees(), netGbp: -fees() }
  };

  pf.availableBalanceGbp = round2(pf.availableBalanceGbp - trade.sizeGbp);
  pf.investedAmountGbp = round2(pf.investedAmountGbp + trade.sizeGbp);
  pf.openTrades.push(trade);
  brain("trade_open", `${pot.toUpperCase()} ${trade.side} ${trade.symbol}`, { reason: trade.reasonEntry });
  return trade;
}

function closeTrade(id, reason, panic = false) {
  for (const pot of ["scalp", "strategy"]) {
    const pf = state.portfolios[pot];
    const trade = pf.openTrades.find(t => t.id === id);
    if (!trade) continue;

    const price = state.prices[trade.symbol]?.price || trade.currentPrice;
    trade.currentPrice = price;
    trade.pnl = pnl(trade, price);
    trade.exitTime = new Date().toISOString();
    trade.exitPrice = price;
    trade.status = "CLOSED";
    trade.reasonExit = reason;
    trade.panicSell = panic;

    pf.openTrades = pf.openTrades.filter(t => t.id !== id);
    pf.closedTrades.unshift(trade);
    pf.availableBalanceGbp = round2(pf.availableBalanceGbp + trade.sizeGbp + trade.pnl.netGbp);
    pf.investedAmountGbp = round2(pf.investedAmountGbp - trade.sizeGbp);
    pf.realisedPnlGbp = round2(pf.realisedPnlGbp + trade.pnl.netGbp);
    pf.dailyPnlGbp = round2(pf.dailyPnlGbp + trade.pnl.netGbp);
    pf.dailyTrades++;

    state.trades.unshift(trade);
    state.trades = state.trades.slice(0, 1000);
    createWhatIf(trade);

    if (pot === "scalp" && trade.pnl.netGbp < 0) {
      const key = pairLossKey(trade.symbol);
      state.scalpSafety.pairLossesToday[key] = (state.scalpSafety.pairLossesToday[key] || 0) + 1;
      const losses = state.scalpSafety.pairLossesToday[key];
      state.scalpSafety.pairCooldownUntil[trade.symbol] = Date.now() + (losses >= 2 ? 30 : 3) * 60 * 1000;
    }

    brain("trade_close", `${pot.toUpperCase()} ${trade.symbol} ${reason}`, { pnl: trade.pnl.netGbp });
    return trade;
  }
  return null;
}

function updateTrail(trade) {
  const net = trade.pnl.netGbp;
  if (net > trade.peakNetPnlGbp) trade.peakNetPnlGbp = net;

  if (trade.pot === "scalp") {
    if (net >= state.settings.scalp.trailActivationNetGbp) {
      const lock = Math.max(state.settings.scalp.trueProfitLockGbp, Math.min(net - 1.25, state.settings.scalp.idealNetProfitGbp));
      trade.lockedProfitGbp = Math.max(trade.lockedProfitGbp, lock);
      const px = priceForNet(trade, lock);
      if (!trade.trailingStopPrice) trade.trailingStopPrice = px;
      else if (trade.side === "LONG") trade.trailingStopPrice = Math.max(trade.trailingStopPrice, px);
      else trade.trailingStopPrice = Math.min(trade.trailingStopPrice, px);
    }
    return;
  }

  if (net >= state.settings.strategy.trailActivationNetGbp) {
    const lock = Math.max(state.settings.strategy.profitLockNetGbp, net - 10);
    trade.lockedProfitGbp = Math.max(trade.lockedProfitGbp, lock);
    const px = priceForNet(trade, lock);
    if (!trade.trailingStopPrice) trade.trailingStopPrice = px;
    else if (trade.side === "LONG") trade.trailingStopPrice = Math.max(trade.trailingStopPrice, px);
    else trade.trailingStopPrice = Math.min(trade.trailingStopPrice, px);
  }
}

function hitTrail(t) {
  if (!t.trailingStopPrice) return false;
  return t.side === "LONG" ? t.currentPrice <= t.trailingStopPrice : t.currentPrice >= t.trailingStopPrice;
}

function evaluateOpenTrades() {
  for (const pot of ["scalp", "strategy"]) {
    const pf = state.portfolios[pot];

    for (const t of [...pf.openTrades]) {
      const price = state.prices[t.symbol]?.price;
      if (!price) continue;

      t.currentPrice = price;
      t.pnl = pnl(t, price);
      updateTrail(t);

      const net = t.pnl.netGbp;

      if (pot === "scalp" && net <= -6) {
        const m = candleMomentum(t.symbol, "1m", 2);
        const against = (t.side === "LONG" && m < 0) || (t.side === "SHORT" && m > 0);
        if (against) {
          closeTrade(t.id, "Scalp defensive exit");
          continue;
        }
      }

      if (net <= t.stopLossNetGbp) {
        closeTrade(t.id, "Stop loss hit");
        continue;
      }

      if (hitTrail(t)) {
        closeTrade(t.id, "Trailing stop hit");
        continue;
      }

      if (pot === "scalp") {
        const learn = learningFor(t.symbol, "scalp");
        const target = Math.max(state.settings.scalp.minimumNetProfitGbp, Math.min(state.settings.scalp.maxQuickWinGbp, state.settings.scalp.idealNetProfitGbp + learn.targetAdjustGbp));

        if (net >= target && learn.bias !== "HOLD_WINNERS_ONLY") {
          closeTrade(t.id, "Scalp take profit");
          continue;
        }

        t.botThinking = `Scalp candle trade. Net ${money(net)} Target ${money(target)} Trail ${t.trailingStopPrice || "not active"}`;
      } else {
        if (net >= t.targetNetGbp) {
          closeTrade(t.id, "Strategy target profit");
          continue;
        }
        t.botThinking = `Strategy holding. Net ${money(net)} Target ${money(t.targetNetGbp)}`;
      }
    }

    recalc(pf);
  }
}

function recalc(pf) {
  pf.openPnlGbp = round2(pf.openTrades.reduce((s, t) => s + (t.pnl?.netGbp || 0), 0));
  pf.investedAmountGbp = round2(pf.openTrades.reduce((s, t) => s + t.sizeGbp, 0));
  pf.totalValueGbp = round2(pf.availableBalanceGbp + pf.investedAmountGbp + pf.openPnlGbp);
}

function combined() {
  const a = state.portfolios.scalp;
  const b = state.portfolios.strategy;
  return {
    availableBalanceGbp: round2(a.availableBalanceGbp + b.availableBalanceGbp),
    investedAmountGbp: round2(a.investedAmountGbp + b.investedAmountGbp),
    openPnlGbp: round2(a.openPnlGbp + b.openPnlGbp),
    realisedPnlGbp: round2(a.realisedPnlGbp + b.realisedPnlGbp),
    totalValueGbp: round2(a.totalValueGbp + b.totalValueGbp)
  };
}

/*
==================================================
BINANCE FEED
==================================================
*/

let binanceWs = null;

function startFeed() {
  const streams = activePairs().flatMap(p => [
    `${p.toLowerCase()}@ticker`,
    `${p.toLowerCase()}@bookTicker`
  ]).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  if (binanceWs) {
    try { binanceWs.close(); } catch {}
  }

  binanceWs = new WebSocket(url);

  binanceWs.on("open", () => {
    state.market.feedStatus = "connected";
    state.market.websocketConnected = true;
    brain("feed", "Binance WebSocket connected");
  });

  binanceWs.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const d = msg.data || msg;
      const symbol = d.s;
      if (!symbol) return;

      // Book ticker gives live bid/ask spread.
      if (d.b && d.a) {
        const bid = Number(d.b);
        const ask = Number(d.a);
        const mid = (bid + ask) / 2;
        const spreadPercent = mid > 0 ? ((ask - bid) / mid) * 100 : 999;

        state.orderBooks[symbol] = {
          symbol,
          bid,
          ask,
          mid,
          spreadPercent,
          time: Date.now()
        };
        return;
      }

      const price = Number(d.c);
      const volume = Number(d.q || d.v || 0);
      if (!price) return;

      state.prices[symbol] = { symbol, price, volume, time: Date.now() };
      updateCandles(symbol, price, volume);

      state.market.lastPriceUpdate = Date.now();
      state.market.messageCount++;
    } catch (e) {
      brain("feed_error", e.message);
    }
  });

  binanceWs.on("close", () => {
    state.market.feedStatus = "closed";
    state.market.websocketConnected = false;
    setTimeout(startFeed, 5000);
  });

  binanceWs.on("error", e => {
    state.market.feedStatus = "error";
    state.market.websocketConnected = false;
    brain("feed_error", e.message);
  });
}

/*
==================================================
ENGINE LOOP
==================================================
*/

function engineLoop() {
  try {
    if (!state.engine.running) return;

    const reviews = [];
    for (const symbol of activePairs()) {
      reviews.push(evaluateScalp(symbol));
      reviews.push(evaluateStrategy(symbol));
    }

    state.reviewedPairs = reviews;
    evaluateOpenTrades();

    if (!state.engine.paused) {
      const scalpSlots = state.settings.scalp.maxOpenTrades - state.portfolios.scalp.openTrades.length;
      const strategySlots = state.settings.strategy.maxOpenTrades - state.portfolios.strategy.openTrades.length;

      const scalpCandidates = reviews.filter(r => r.pot === "scalp" && r.canBuy).sort((a, b) => b.confidence - a.confidence).slice(0, Math.max(0, scalpSlots));
      const strategyCandidates = reviews.filter(r => r.pot === "strategy" && r.canBuy).sort((a, b) => b.confidence - a.confidence).slice(0, Math.max(0, strategySlots));

      for (const r of scalpCandidates) openTrade("scalp", r);
      for (const r of strategyCandidates) openTrade("strategy", r);
    }

    saveState();
    broadcast({ type: "state", payload: publicState() });
  } catch (e) {
    brain("engine_error", e.message);
  }
}

setInterval(engineLoop, 2000);

/*
==================================================
API
==================================================
*/

const app = express();
app.use(express.json());

function publicState() {
  recalc(state.portfolios.scalp);
  recalc(state.portfolios.strategy);
  return {
    version: APP_VERSION,
    paperModeOnly: PAPER_MODE_ONLY,
    dataMode: { prices: "REAL_BINANCE_WEBSOCKET", trades: "PAPER_SIMULATED", realMoney: false },
    engine: state.engine,
    market: state.market,
    settings: state.settings,
    portfolios: state.portfolios,
    combined: combined(),
    reviewedPairs: state.reviewedPairs,
    brain: state.brain.slice(0, 100),
    whatIf: state.whatIf.slice(0, 100),
    recentTrades: state.trades.slice(0, 100),
    candles: state.candles,
    orderBooks: state.orderBooks,
    prices: state.prices
  };
}

app.get("/", (req, res) => res.json({ name: "ApexQuant V8", version: APP_VERSION }));
app.get("/api/health", (req, res) => res.json({ ok: true, version: APP_VERSION, paperModeOnly: true, uptime: process.uptime() }));
app.get("/api/state", (req, res) => res.json(publicState()));
app.get("/api/settings", (req, res) => res.json(state.settings));

app.post("/api/settings", (req, res) => {
  state.settings = { ...state.settings, ...req.body };
  saveState();
  startFeed();
  res.json({ success: true, settings: state.settings });
});

app.post("/api/start", (req, res) => {
  state.engine.running = true;
  state.engine.paused = false;
  state.engine.reason = "V8 running paper mode";
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/stop", (req, res) => {
  state.engine.running = false;
  state.engine.reason = "Stopped";
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/pause", (req, res) => {
  state.engine.paused = true;
  state.engine.reason = "Paused";
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/resume", (req, res) => {
  state.engine.paused = false;
  state.engine.reason = "Resumed";
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/trades/:id/panic-sell", (req, res) => {
  const t = closeTrade(req.params.id, "PANIC SELL", true);
  if (!t) return res.status(404).json({ success: false, error: "Trade not found" });
  saveState();
  res.json({ success: true, instant: true, trade: t });
});

app.post("/api/close-all", (req, res) => {
  const closed = [];
  for (const pot of ["scalp", "strategy"]) {
    for (const t of [...state.portfolios[pot].openTrades]) {
      const c = closeTrade(t.id, "CLOSE ALL", true);
      if (c) closed.push(c);
    }
  }
  saveState();
  res.json({ success: true, closed });
});

app.post("/api/brain/ask", (req, res) => {
  res.json({ answer: state.brain.slice(0, 10).map(b => `${b.type}: ${b.message}`).join("\n") });
});

/*
==================================================
WEBSOCKET + START
==================================================
*/

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Set();

wss.on("connection", ws => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "state", payload: publicState() }));
  ws.on("close", () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

loadState();
startFeed();

server.listen(PORT, "0.0.0.0", () => {
  brain("system", `ApexQuant V8 running on port ${PORT}`);
  console.log(`ApexQuant V8 running on http://0.0.0.0:${PORT}`);
});
