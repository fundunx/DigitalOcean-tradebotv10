/*
==================================================
APEXQUANT V6
FILE: backend/server.js
VERSION: 6.0.0
MODE: PAPER TRADING ONLY
PORT: 8091

PURPOSE:
Clean backend rewrite.
No old bot code.
No live money.
Two separate paper portfolios:
1. Scalp Pot
2. Strategy Pot

DO NOT EDIT WITHOUT BACKUP.
==================================================
*/

// ==================================================
// SECTION 1: IMPORTS
// ==================================================

const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");

// ==================================================
// SECTION 2: APP CONFIG
// ==================================================

const APP_VERSION = "6.0.0";
const PORT = 8091;

const ROOT_DIR = "/var/www/apexquant-v6";
const DATA_DIR = path.join(ROOT_DIR, "data");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const STATE_FILE = path.join(DATA_DIR, "state-v6.json");
const BRAIN_LOG_FILE = path.join(LOG_DIR, "bot-brain.log");

const PAPER_MODE_ONLY = true;

const GBP_USD_RATE = 0.785;

// Fee model requested by user.
const DEFAULT_BUY_FEE_GBP = 1.0;
const DEFAULT_SELL_FEE_GBP = 1.0;

// ==================================================
// SECTION 3: FILE SYSTEM SETUP
// ==================================================

function ensureFolders() {
  for (const dir of [DATA_DIR, LOG_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

ensureFolders();

// ==================================================
// SECTION 4: DEFAULT SETTINGS
// ==================================================

const TOP_50_PAIRS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "TRXUSDT",
  "LINKUSDT", "MATICUSDT", "LTCUSDT", "UNIUSDT", "NEARUSDT",
  "APTUSDT", "ATOMUSDT", "ETCUSDT", "ICPUSDT", "FILUSDT",
  "XLMUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "IMXUSDT",
  "GRTUSDT", "STXUSDT", "RNDRUSDT", "INJUSDT", "ALGOUSDT",
  "SEIUSDT", "TIAUSDT", "PEPEUSDT", "FETUSDT", "RUNEUSDT",
  "PYTHUSDT", "JUPUSDT", "WIFUSDT", "WLDUSDT", "AAVEUSDT",
  "MKRUSDT", "LDOUSDT", "SANDUSDT", "MANAUSDT", "FLOWUSDT",
  "DYDXUSDT", "ORDIUSDT", "ARKMUSDT", "ETCUSDT", "BCHUSDT"
];

const DEFAULT_SETTINGS = {
  paperMode: true,
  liveModeLocked: true,

  pairMode: "TOP_50", // TOP_10, TOP_20, TOP_50, CUSTOM
  customPairs: [],

  buyFeeGbp: DEFAULT_BUY_FEE_GBP,
  sellFeeGbp: DEFAULT_SELL_FEE_GBP,
  slippageAllowancePercent: 0.05,
  maxSpreadPercent: 0.15,

  scalp: {
    startingBalanceGbp: 10000,
    tradeSizeGbp: 2000,
    maxUsableCapitalPercent: 100,
    dailyTargetGbp: 200,
    targetNetProfitGbp: 8,
    minimumNetProfitGbp: 3,
    trailActivationNetGbp: 5,
    profitLockNetGbp: 3,
    maxLossPerTradePercent: 1.0,
    maxDailyLossPercent: 3.0,
    reinvestPercent: 50,
    allowLong: true,
    allowShort: true
  },

  strategy: {
    startingBalanceGbp: 10000,
    tradeSizeGbp: 2000,
    maxUsableCapitalPercent: 100,
    dailyTargetGbp: 200,
    targetNetProfitGbp: 30,
    minimumNetProfitGbp: 10,
    trailActivationNetGbp: 20,
    profitLockNetGbp: 10,
    maxLossPerTradePercent: 2.0,
    maxDailyLossPercent: 5.0,
    reinvestPercent: 50,
    allowLong: true,
    allowShort: true
  },

  reinvestment: {
    source: "BOTH_POTS", // SCALP_ONLY, STRATEGY_ONLY, BOTH_POTS, SHARED_PROFIT_POOL
    scalpReinvestPercent: 50,
    strategyReinvestPercent: 50
  },

  safety: {
    pauseNewTradesOnly: true,
    emergencyCloseRequiresRule: true,
    protectDayAfterTarget: true,
    afterTargetBeMoreSelective: true
  }
};

// ==================================================
// SECTION 5: STATE
// ==================================================

let state = null;

function createFreshState() {
  return {
    version: APP_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    engine: {
      running: false,
      paused: false,
      mode: "PAPER",
      reason: "Engine stopped"
    },

    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),

    market: {
      feedStatus: "starting",
      lastPriceUpdate: null,
      websocketConnected: false,
      messageCount: 0
    },

    prices: {},
    priceHistory: {},

    portfolios: {
      scalp: createPortfolio("scalp", DEFAULT_SETTINGS.scalp.startingBalanceGbp),
      strategy: createPortfolio("strategy", DEFAULT_SETTINGS.strategy.startingBalanceGbp)
    },

    reviewedPairs: [],
    brain: [],
    trades: [],
    whatIf: [],
    alerts: []
  };
}

function createPortfolio(id, startingBalance) {
  return {
    id,
    name: id === "scalp" ? "Scalp Pot" : "Strategy Pot",
    startingBalanceGbp: startingBalance,
    availableBalanceGbp: startingBalance,
    investedAmountGbp: 0,
    realisedPnlGbp: 0,
    openPnlGbp: 0,
    totalValueGbp: startingBalance,
    openTrades: [],
    closedTrades: [],
    dailyPnlGbp: 0,
    dailyTrades: 0
  };
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      brainLog("system", "Loaded existing V6 state file");
      return;
    } catch (err) {
      console.error("State load failed:", err.message);
    }
  }

  state = createFreshState();
  saveState();
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ==================================================
// SECTION 6: BOT BRAIN LOGGING
// ==================================================

function brainLog(type, message, extra = {}) {
  const entry = {
    time: new Date().toISOString(),
    type,
    message,
    ...extra
  };

  if (state && state.brain) {
    state.brain.unshift(entry);
    if (state.brain.length > 300) state.brain = state.brain.slice(0, 300);
  }

  try {
    fs.appendFileSync(BRAIN_LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (_) {}

  console.log(`[BRAIN] ${type}: ${message}`);
  return entry;
}

// ==================================================
// SECTION 7: PAIR SELECTION
// ==================================================

function getActivePairs() {
  const mode = state.settings.pairMode;

  if (mode === "TOP_10") return TOP_50_PAIRS.slice(0, 10);
  if (mode === "TOP_20") return TOP_50_PAIRS.slice(0, 20);
  if (mode === "CUSTOM" && Array.isArray(state.settings.customPairs) && state.settings.customPairs.length > 0) {
    return state.settings.customPairs.map(p => String(p).toUpperCase().trim()).filter(Boolean);
  }

  return TOP_50_PAIRS.slice(0, 50);
}

// ==================================================
// SECTION 8: BINANCE WEBSOCKET MARKET FEED
// ==================================================

let binanceWs = null;
let reconnectTimer = null;

function startBinanceFeed() {
  const pairs = getActivePairs();
  const streams = pairs.map(p => `${p.toLowerCase()}@ticker`).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  brainLog("feed", `Connecting Binance WebSocket for ${pairs.length} pairs`);

  if (binanceWs) {
    try { binanceWs.close(); } catch (_) {}
  }

  binanceWs = new WebSocket(url);

  binanceWs.on("open", () => {
    state.market.feedStatus = "connected";
    state.market.websocketConnected = true;
    brainLog("feed", "Binance WebSocket connected");
    broadcast({ type: "feed", status: state.market });
  });

  binanceWs.on("message", raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const data = msg.data || msg;

      const symbol = data.s;
      const price = Number(data.c);
      const volume = Number(data.q || data.v || 0);

      if (!symbol || !price) return;

      state.prices[symbol] = {
        symbol,
        price,
        volume,
        time: Date.now()
      };

      if (!state.priceHistory[symbol]) state.priceHistory[symbol] = [];

      state.priceHistory[symbol].push({
        price,
        volume,
        time: Date.now()
      });

      if (state.priceHistory[symbol].length > 500) {
        state.priceHistory[symbol] = state.priceHistory[symbol].slice(-500);
      }

      state.market.lastPriceUpdate = Date.now();
      state.market.messageCount++;

    } catch (err) {
      brainLog("feed_error", "Failed to parse Binance WebSocket message", { error: err.message });
    }
  });

  binanceWs.on("close", () => {
    state.market.feedStatus = "closed";
    state.market.websocketConnected = false;
    brainLog("feed", "Binance WebSocket closed. Reconnecting.");
    scheduleReconnect();
  });

  binanceWs.on("error", err => {
    state.market.feedStatus = "error";
    state.market.websocketConnected = false;
    brainLog("feed_error", "Binance WebSocket error", { error: err.message });
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startBinanceFeed();
  }, 5000);
}

function isPriceFresh() {
  if (!state.market.lastPriceUpdate) return false;
  return Date.now() - state.market.lastPriceUpdate < 15000;
}

// ==================================================
// SECTION 9: INDICATORS
// ==================================================

function getHistory(symbol, limit = 100) {
  const hist = state.priceHistory[symbol] || [];
  return hist.slice(-limit);
}

function simpleMovingAverage(symbol, period) {
  const hist = getHistory(symbol, period);
  if (hist.length < period) return null;
  return hist.reduce((sum, x) => sum + x.price, 0) / hist.length;
}

function momentumPercent(symbol, lookback = 10) {
  const hist = getHistory(symbol, lookback + 1);
  if (hist.length < lookback + 1) return 0;
  const first = hist[0].price;
  const last = hist[hist.length - 1].price;
  return ((last - first) / first) * 100;
}

function volatilityPercent(symbol, lookback = 30) {
  const hist = getHistory(symbol, lookback);
  if (hist.length < lookback) return 0;

  const prices = hist.map(x => x.price);
  const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg, 2), 0) / prices.length;
  return (Math.sqrt(variance) / avg) * 100;
}

function supportResistance(symbol, lookback = 80) {
  const hist = getHistory(symbol, lookback);
  if (hist.length < 20) {
    return { support: null, resistance: null, confidence: 0 };
  }

  const prices = hist.map(x => x.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const current = prices[prices.length - 1];

  const support = low + (high - low) * 0.10;
  const resistance = high - (high - low) * 0.10;

  const range = high - low;
  const confidence = range > 0 ? Math.min(100, Math.round((range / current) * 10000)) : 0;

  return { support, resistance, confidence };
}

function btcRegime() {
  const btc = state.prices.BTCUSDT;
  if (!btc) return "UNKNOWN";

  const mom = momentumPercent("BTCUSDT", 20);
  const vol = volatilityPercent("BTCUSDT", 30);

  if (mom <= -1.5 && vol > 0.5) return "BTC_RISK_OFF";
  if (mom >= 1.0) return "BTC_BULLISH";
  if (Math.abs(mom) < 0.3) return "BTC_CHOP";
  if (mom < 0) return "BTC_WEAK";

  return "BTC_NEUTRAL";
}

// ==================================================
// SECTION 10: FEE AND PROFIT MATH
// ==================================================

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function estimateFeesGbp(exitCount = 1) {
  return state.settings.buyFeeGbp + (state.settings.sellFeeGbp * exitCount);
}

function calculatePnlGbp(trade, currentPrice) {
  const direction = trade.side === "LONG" ? 1 : -1;
  const priceMove = (currentPrice - trade.entryPrice) * direction;
  const units = trade.sizeGbp / trade.entryPrice;
  const grossUsd = priceMove * units;
  const grossGbp = grossUsd * GBP_USD_RATE;
  const totalFees = estimateFeesGbp(trade.exitCount || 1);
  const netGbp = grossGbp - totalFees;

  return {
    grossGbp: round2(grossGbp),
    feesGbp: round2(totalFees),
    netGbp: round2(netGbp)
  };
}

// ==================================================
// SECTION 11: SIGNAL ENGINE
// ==================================================

function evaluatePair(symbol, potId) {
  const priceObj = state.prices[symbol];
  const settings = potId === "scalp" ? state.settings.scalp : state.settings.strategy;

  if (!priceObj) {
    return review(symbol, potId, "WAIT", "No live price yet", 0);
  }

  const price = priceObj.price;
  const mom5 = momentumPercent(symbol, 5);
  const mom20 = momentumPercent(symbol, 20);
  const vol = volatilityPercent(symbol, 30);
  const sr = supportResistance(symbol);
  const btc = btcRegime();

  let signal = "HOLD";
  let confidence = 50;
  let reason = "Watching market structure";
  let strategy = potId === "scalp" ? "Scalp Momentum" : "Support/Resistance Trend";

  const nearSupport = sr.support && price <= sr.support * 1.004;
  const nearResistance = sr.resistance && price >= sr.resistance * 0.996;

  if (nearSupport && mom5 > 0 && settings.allowLong) {
    signal = "LONG";
    confidence = 72;
    reason = "Price near support and short-term momentum improving";
  }

  if (nearResistance && mom5 < 0 && settings.allowShort) {
    signal = "SHORT";
    confidence = 72;
    reason = "Price near resistance and momentum weakening";
  }

  if (mom20 > 0.6 && mom5 > 0.1 && settings.allowLong) {
    signal = "LONG";
    confidence = Math.max(confidence, 78);
    reason = "Trend continuation detected";
  }

  if (mom20 < -0.6 && mom5 < -0.1 && settings.allowShort) {
    signal = "SHORT";
    confidence = Math.max(confidence, 78);
    reason = "Downtrend continuation detected";
  }

  if (btc === "BTC_RISK_OFF" && signal === "LONG") {
    signal = "REJECT";
    confidence = 25;
    reason = "Rejected long because BTC is risk-off";
  }

  const expectedNet = estimateExpectedNetProfitGbp(symbol, settings.tradeSizeGbp, potId);

  if (signal !== "REJECT" && expectedNet < settings.minimumNetProfitGbp) {
    signal = "REJECT";
    reason = `Expected net £${expectedNet.toFixed(2)} below minimum £${settings.minimumNetProfitGbp}`;
    confidence = Math.min(confidence, 40);
  }

  return review(symbol, potId, signal, reason, confidence, {
    price,
    strategy,
    expectedNetGbp: round2(expectedNet),
    support: sr.support,
    resistance: sr.resistance,
    btcRegime: btc,
    momentum5: round2(mom5),
    momentum20: round2(mom20),
    volatility: round2(vol)
  });
}

function estimateExpectedNetProfitGbp(symbol, tradeSizeGbp, potId) {
  const vol = volatilityPercent(symbol, 30);
  const expectedMovePercent = potId === "scalp"
    ? Math.max(0.2, vol * 0.8)
    : Math.max(0.6, vol * 1.5);

  const gross = tradeSizeGbp * (expectedMovePercent / 100);
  const fees = estimateFeesGbp(1);

  return gross - fees;
}

function review(symbol, potId, signal, reason, confidence, extra = {}) {
  return {
    id: `${potId}_${symbol}`,
    time: new Date().toISOString(),
    symbol,
    pot: potId,
    signal,
    reason,
    confidence,
    ...extra
  };
}

// ==================================================
// SECTION 12: RISK ENGINE
// ==================================================

function canOpenTrade(potId, reviewData) {
  if (!state.engine.running) return { ok: false, reason: "Engine stopped" };
  if (state.engine.paused) return { ok: false, reason: "Paused: no new trades" };
  if (!isPriceFresh()) return { ok: false, reason: "Market feed stale" };

  const portfolio = state.portfolios[potId];
  const settings = potId === "scalp" ? state.settings.scalp : state.settings.strategy;

  if (reviewData.signal !== "LONG" && reviewData.signal !== "SHORT") {
    return { ok: false, reason: reviewData.reason };
  }

  if (portfolio.openTrades.find(t => t.symbol === reviewData.symbol)) {
    return { ok: false, reason: "Already has open trade on this pair in this pot" };
  }

  const usableCapital = settings.startingBalanceGbp * (settings.maxUsableCapitalPercent / 100);
  if (portfolio.investedAmountGbp + settings.tradeSizeGbp > usableCapital) {
    return { ok: false, reason: "Usable capital limit reached" };
  }

  if (portfolio.availableBalanceGbp < settings.tradeSizeGbp) {
    return { ok: false, reason: "Not enough available balance" };
  }

  if (reviewData.confidence < 70) {
    return { ok: false, reason: "Confidence below 70%" };
  }

  return { ok: true, reason: "Risk checks passed" };
}

// ==================================================
// SECTION 13: PAPER TRADE EXECUTION
// ==================================================

function openPaperTrade(potId, reviewData) {
  const portfolio = state.portfolios[potId];
  const settings = potId === "scalp" ? state.settings.scalp : state.settings.strategy;
  const price = state.prices[reviewData.symbol]?.price;

  if (!price) return null;

  const riskAmountGbp = settings.tradeSizeGbp * (settings.maxLossPerTradePercent / 100);

  const trade = {
    id: `T_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pot: potId,
    symbol: reviewData.symbol,
    side: reviewData.signal,
    strategy: reviewData.strategy,
    entryTime: new Date().toISOString(),
    entryPrice: price,
    currentPrice: price,
    sizeGbp: settings.tradeSizeGbp,
    status: "OPEN",
    confidence: reviewData.confidence,
    reasonEntry: reviewData.reason,

    buyFeeGbp: state.settings.buyFeeGbp,
    estimatedSellFeeGbp: state.settings.sellFeeGbp,
    exitCount: 1,

    stopLossNetGbp: -riskAmountGbp,
    targetNetGbp: settings.targetNetProfitGbp,
    trailActivationNetGbp: settings.trailActivationNetGbp,
    profitLockNetGbp: settings.profitLockNetGbp,

    peakNetPnlGbp: 0,
    lockedProfitGbp: 0,
    botThinking: "Trade opened in paper mode after passing risk checks",

    pnl: {
      grossGbp: 0,
      feesGbp: estimateFeesGbp(1),
      netGbp: -estimateFeesGbp(1)
    }
  };

  portfolio.availableBalanceGbp -= settings.tradeSizeGbp;
  portfolio.investedAmountGbp += settings.tradeSizeGbp;
  portfolio.openTrades.push(trade);

  brainLog("trade_open", `${potId.toUpperCase()} opened ${trade.side} ${trade.symbol}`, {
    tradeId: trade.id,
    reason: trade.reasonEntry
  });

  return trade;
}

function closePaperTrade(tradeId, reason, panic = false) {
  for (const potId of ["scalp", "strategy"]) {
    const portfolio = state.portfolios[potId];
    const trade = portfolio.openTrades.find(t => t.id === tradeId);
    if (!trade) continue;

    const price = state.prices[trade.symbol]?.price || trade.currentPrice || trade.entryPrice;
    const pnl = calculatePnlGbp(trade, price);

    trade.status = "CLOSED";
    trade.exitTime = new Date().toISOString();
    trade.exitPrice = price;
    trade.reasonExit = reason;
    trade.panicSell = panic;
    trade.pnl = pnl;

    portfolio.openTrades = portfolio.openTrades.filter(t => t.id !== tradeId);
    portfolio.closedTrades.unshift(trade);

    portfolio.availableBalanceGbp += trade.sizeGbp + pnl.netGbp;
    portfolio.investedAmountGbp -= trade.sizeGbp;
    portfolio.realisedPnlGbp += pnl.netGbp;
    portfolio.dailyPnlGbp += pnl.netGbp;
    portfolio.dailyTrades++;

    state.trades.unshift(trade);

    createWhatIfTracker(trade);

    brainLog("trade_close", `${potId.toUpperCase()} closed ${trade.symbol}: ${reason}`, {
      tradeId,
      netPnlGbp: pnl.netGbp,
      panicSell: panic
    });

    return trade;
  }

  return null;
}

// ==================================================
// SECTION 14: EXIT ENGINE
// ==================================================

function evaluateOpenTrades() {
  for (const potId of ["scalp", "strategy"]) {
    const portfolio = state.portfolios[potId];
    const settings = potId === "scalp" ? state.settings.scalp : state.settings.strategy;

    for (const trade of [...portfolio.openTrades]) {
      const price = state.prices[trade.symbol]?.price;
      if (!price) continue;

      trade.currentPrice = price;
      trade.pnl = calculatePnlGbp(trade, price);

      if (trade.pnl.netGbp > trade.peakNetPnlGbp) {
        trade.peakNetPnlGbp = trade.pnl.netGbp;
      }

      const net = trade.pnl.netGbp;

      if (net <= trade.stopLossNetGbp) {
        trade.botThinking = `Stop loss hit at £${net}. Closing to protect capital.`;
        closePaperTrade(trade.id, "Hard stop loss hit");
        continue;
      }

      if (net >= trade.trailActivationNetGbp) {
        trade.lockedProfitGbp = Math.max(trade.lockedProfitGbp, trade.profitLockNetGbp);

        const pullback = trade.peakNetPnlGbp - net;
        const allowedPullback = potId === "scalp" ? 3 : 10;

        if (pullback >= allowedPullback && net >= trade.lockedProfitGbp) {
          trade.botThinking = `Trailing stop triggered. Peak £${trade.peakNetPnlGbp}, now £${net}.`;
          closePaperTrade(trade.id, "Adaptive trailing stop");
          continue;
        }
      }

      if (net >= trade.targetNetGbp) {
        const holdDecision = shouldHoldWinner(trade, potId);

        if (!holdDecision.hold) {
          trade.botThinking = holdDecision.reason;
          closePaperTrade(trade.id, "Fee-aware take profit");
          continue;
        }

        trade.botThinking = holdDecision.reason;
      } else {
        trade.botThinking = `Holding. Net P&L £${net}. Target £${trade.targetNetGbp}.`;
      }
    }

    recalcPortfolio(portfolio);
  }
}

function shouldHoldWinner(trade, potId) {
  const btc = btcRegime();
  const mom5 = momentumPercent(trade.symbol, 5);
  const sr = supportResistance(trade.symbol);
  const price = trade.currentPrice;

  if (trade.side === "LONG" && sr.resistance && price >= sr.resistance * 0.998) {
    return { hold: false, reason: "Taking profit near resistance before common sell zone" };
  }

  if (trade.side === "SHORT" && sr.support && price <= sr.support * 1.002) {
    return { hold: false, reason: "Taking profit near support before bounce risk" };
  }

  if (trade.side === "LONG" && btc === "BTC_RISK_OFF") {
    return { hold: false, reason: "Taking profit because BTC risk-off detected" };
  }

  if (trade.side === "LONG" && mom5 > 0.15) {
    return { hold: true, reason: "Holding winner. Momentum remains strong and fees already covered." };
  }

  if (trade.side === "SHORT" && mom5 < -0.15) {
    return { hold: true, reason: "Holding short. Downtrend momentum remains strong." };
  }

  return { hold: false, reason: "Target reached and momentum is not strong enough to justify holding." };
}

// ==================================================
// SECTION 15: WHATIF ENGINE
// ==================================================

const WHATIF_INTERVALS = [
  { key: "m1", label: "1m", ms: 1 * 60 * 1000 },
  { key: "m3", label: "3m", ms: 3 * 60 * 1000 },
  { key: "m5", label: "5m", ms: 5 * 60 * 1000 },
  { key: "m10", label: "10m", ms: 10 * 60 * 1000 },
  { key: "m15", label: "15m", ms: 15 * 60 * 1000 },
  { key: "m20", label: "20m", ms: 20 * 60 * 1000 },
  { key: "h1", label: "1h", ms: 60 * 60 * 1000 },
  { key: "h4", label: "4h", ms: 4 * 60 * 60 * 1000 },
  { key: "h24", label: "24h", ms: 24 * 60 * 60 * 1000 }
];

function createWhatIfTracker(trade) {
  const tracker = {
    id: `WI_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tradeId: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    pot: trade.pot,
    entryPrice: trade.entryPrice,
    actualExitPrice: trade.exitPrice,
    actualNetPnlGbp: trade.pnl.netGbp,
    closeTime: Date.now(),
    intervals: {},
    lesson: "Tracking started"
  };

  for (const interval of WHATIF_INTERVALS) {
    tracker.intervals[interval.key] = {
      label: interval.label,
      checked: false,
      price: null,
      netPnlGbp: null,
      differenceVsActualGbp: null
    };
  }

  state.whatIf.unshift(tracker);

  brainLog("whatif", `Started WhatIf tracking for ${trade.symbol}`, {
    tradeId: trade.id
  });
}

function updateWhatIfTrackers() {
  const now = Date.now();

  for (const tracker of state.whatIf) {
    const price = state.prices[tracker.symbol]?.price;
    if (!price) continue;

    for (const interval of WHATIF_INTERVALS) {
      const item = tracker.intervals[interval.key];
      if (item.checked) continue;

      if (now - tracker.closeTime >= interval.ms) {
        const fakeTrade = {
          side: tracker.side,
          entryPrice: tracker.entryPrice,
          sizeGbp: 2000,
          exitCount: 1
        };

        const pnl = calculatePnlGbp(fakeTrade, price);

        item.checked = true;
        item.price = price;
        item.netPnlGbp = pnl.netGbp;
        item.differenceVsActualGbp = round2(pnl.netGbp - tracker.actualNetPnlGbp);

        tracker.lesson = buildWhatIfLesson(tracker);
      }
    }
  }
}

function buildWhatIfLesson(tracker) {
  const checked = Object.values(tracker.intervals).filter(x => x.checked);
  if (!checked.length) return "Waiting for post-exit data";

  const best = checked.reduce((a, b) => (b.netPnlGbp > a.netPnlGbp ? b : a), checked[0]);
  const worst = checked.reduce((a, b) => (b.netPnlGbp < a.netPnlGbp ? b : a), checked[0]);

  if (best.netPnlGbp > tracker.actualNetPnlGbp + 3) {
    return `Possible early exit. Best so far: ${best.label}, extra £${round2(best.netPnlGbp - tracker.actualNetPnlGbp)}.`;
  }

  if (worst.netPnlGbp < tracker.actualNetPnlGbp - 3) {
    return `Exit protected capital. Worst later result was ${worst.label}, avoided £${round2(tracker.actualNetPnlGbp - worst.netPnlGbp)} loss.`;
  }

  return "Exit timing looks reasonable so far.";
}

// ==================================================
// SECTION 16: PORTFOLIO CALCULATION
// ==================================================

function recalcPortfolio(portfolio) {
  portfolio.openPnlGbp = round2(portfolio.openTrades.reduce((sum, t) => sum + (t.pnl?.netGbp || 0), 0));
  portfolio.investedAmountGbp = round2(portfolio.openTrades.reduce((sum, t) => sum + t.sizeGbp, 0));
  portfolio.totalValueGbp = round2(portfolio.availableBalanceGbp + portfolio.investedAmountGbp + portfolio.openPnlGbp);
}

function getCombinedSummary() {
  const scalp = state.portfolios.scalp;
  const strategy = state.portfolios.strategy;

  return {
    startingBalanceGbp: scalp.startingBalanceGbp + strategy.startingBalanceGbp,
    availableBalanceGbp: round2(scalp.availableBalanceGbp + strategy.availableBalanceGbp),
    investedAmountGbp: round2(scalp.investedAmountGbp + strategy.investedAmountGbp),
    openPnlGbp: round2(scalp.openPnlGbp + strategy.openPnlGbp),
    realisedPnlGbp: round2(scalp.realisedPnlGbp + strategy.realisedPnlGbp),
    totalValueGbp: round2(scalp.totalValueGbp + strategy.totalValueGbp)
  };
}

// ==================================================
// SECTION 17: MAIN ENGINE LOOP
// ==================================================

function engineLoop() {
  try {
    if (!state.engine.running) return;

    const pairs = getActivePairs();
    const reviews = [];

    for (const symbol of pairs) {
      reviews.push(evaluatePair(symbol, "scalp"));
      reviews.push(evaluatePair(symbol, "strategy"));
    }

    state.reviewedPairs = reviews.slice(0, 120);

    evaluateOpenTrades();
    updateWhatIfTrackers();

    if (!state.engine.paused) {
      const bestScalp = reviews
        .filter(r => r.pot === "scalp" && (r.signal === "LONG" || r.signal === "SHORT"))
        .sort((a, b) => b.confidence - a.confidence)[0];

      const bestStrategy = reviews
        .filter(r => r.pot === "strategy" && (r.signal === "LONG" || r.signal === "SHORT"))
        .sort((a, b) => b.confidence - a.confidence)[0];

      for (const candidate of [bestScalp, bestStrategy].filter(Boolean)) {
        const risk = canOpenTrade(candidate.pot, candidate);

        if (risk.ok) {
          openPaperTrade(candidate.pot, candidate);
        } else {
          brainLog("trade_reject", `${candidate.pot.toUpperCase()} rejected ${candidate.symbol}`, {
            reason: risk.reason,
            signal: candidate.signal
          });
        }
      }
    } else {
      brainLog("pause", "Paused: not opening new trades, only monitoring open positions");
    }

    saveState();
    broadcast({ type: "state", payload: publicState() });

  } catch (err) {
    brainLog("engine_error", "Engine loop failed", { error: err.message });
  }
}

setInterval(engineLoop, 5000);

// ==================================================
// SECTION 18: PUBLIC STATE FOR DASHBOARD
// ==================================================

function publicState() {
  recalcPortfolio(state.portfolios.scalp);
  recalcPortfolio(state.portfolios.strategy);

  return {
    version: APP_VERSION,
    paperModeOnly: PAPER_MODE_ONLY,
    engine: state.engine,
    market: state.market,
    settings: state.settings,
    portfolios: state.portfolios,
    combined: getCombinedSummary(),
    reviewedPairs: state.reviewedPairs,
    brain: state.brain.slice(0, 100),
    whatIf: state.whatIf.slice(0, 100),
    recentTrades: state.trades.slice(0, 100),
    prices: state.prices
  };
}

// ==================================================
// SECTION 19: EXPRESS SERVER
// ==================================================

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "ApexQuant V6 Backend",
    version: APP_VERSION,
    mode: "PAPER ONLY",
    port: PORT
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    version: APP_VERSION,
    paperModeOnly: PAPER_MODE_ONLY,
    uptime: process.uptime()
  });
});

app.get("/api/state", (req, res) => {
  res.json(publicState());
});

app.get("/api/settings", (req, res) => {
  res.json(state.settings);
});

app.post("/api/settings", (req, res) => {
  state.settings = {
    ...state.settings,
    ...req.body
  };

  brainLog("settings", "Settings updated by user");
  saveState();

  startBinanceFeed();

  res.json({ success: true, settings: state.settings });
});

app.post("/api/start", (req, res) => {
  state.engine.running = true;
  state.engine.paused = false;
  state.engine.reason = "Engine running in paper mode";

  brainLog("engine", "Engine started in paper mode");
  saveState();

  res.json({ success: true, engine: state.engine });
});

app.post("/api/stop", (req, res) => {
  state.engine.running = false;
  state.engine.reason = "Engine stopped by user";

  brainLog("engine", "Engine stopped");
  saveState();

  res.json({ success: true, engine: state.engine });
});

app.post("/api/pause", (req, res) => {
  state.engine.paused = true;
  state.engine.reason = "Paused: no new trades, monitoring open trades only";

  brainLog("pause", "Pause selected. Bot will not open new trades.");
  saveState();

  res.json({ success: true, engine: state.engine });
});

app.post("/api/resume", (req, res) => {
  state.engine.paused = false;
  state.engine.reason = "Trading resumed";

  brainLog("engine", "Trading resumed");
  saveState();

  res.json({ success: true, engine: state.engine });
});

app.post("/api/trades/:id/panic-sell", (req, res) => {
  const trade = closePaperTrade(req.params.id, "PANIC SELL pressed by user", true);

  if (!trade) {
    return res.status(404).json({ success: false, error: "Trade not found" });
  }

  saveState();

  res.json({ success: true, trade });
});

app.post("/api/close-all", (req, res) => {
  const closed = [];

  for (const potId of ["scalp", "strategy"]) {
    for (const trade of [...state.portfolios[potId].openTrades]) {
      const result = closePaperTrade(trade.id, "CLOSE ALL pressed by user", true);
      if (result) closed.push(result);
    }
  }

  saveState();

  res.json({ success: true, closed });
});

app.post("/api/brain/ask", (req, res) => {
  const question = String(req.body.question || "").trim();

  if (!question) {
    return res.status(400).json({ error: "Question required" });
  }

  const answer = answerBrainQuestion(question);

  brainLog("chat", `User asked: ${question}`, { answer });

  res.json({ question, answer });
});

// ==================================================
// SECTION 20: BOT BRAIN CHAT ANSWERS
// ==================================================

function answerBrainQuestion(question) {
  const q = question.toLowerCase();

  if (q.includes("what are you watching") || q.includes("reviewing")) {
    const top = state.reviewedPairs.slice(0, 10)
      .map(r => `${r.symbol} ${r.pot}: ${r.signal} (${r.confidence}%) - ${r.reason}`)
      .join("\n");

    return top || "I am waiting for live market data before reviewing pairs.";
  }

  if (q.includes("why") && q.includes("reject")) {
    const rejected = state.reviewedPairs.filter(r => r.signal === "REJECT").slice(0, 5);
    return rejected.map(r => `${r.symbol}: ${r.reason}`).join("\n") || "No recent rejected pairs.";
  }

  if (q.includes("pause")) {
    return "When paused I stop opening new trades. I keep monitoring open positions and only close if a rule such as stop loss, panic sell, or risk rule is triggered.";
  }

  if (q.includes("target")) {
    return `Scalp target is £${state.settings.scalp.dailyTargetGbp}/day. Strategy target is £${state.settings.strategy.dailyTargetGbp}/day. Targets are guides, not hard stops.`;
  }

  return "I can answer: what are you reviewing, why rejected, why holding, target, pause behaviour, or open trades.";
}

// ==================================================
// SECTION 21: WEBSOCKET FOR DASHBOARD
// ==================================================

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
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// ==================================================
// SECTION 22: STARTUP
// ==================================================

loadState();
startBinanceFeed();

server.listen(PORT, "0.0.0.0", () => {
  brainLog("system", `ApexQuant V6 backend running on port ${PORT}`);
  console.log(`ApexQuant V6 backend running: http://0.0.0.0:${PORT}`);
});
