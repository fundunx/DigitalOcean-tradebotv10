/*
==================================================
APEXQUANT V7 TEST BACKEND
FILE: backend/server-v7.js
VERSION: 7.0.0
PORT: 8094
MODE: PAPER TRADING ONLY

SAFE TEST FILE:
Does not replace live V6.
Does not use real money.
Uses real Binance WebSocket prices.
Keeps current dashboard API shape.
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
// SECTION 2: CONFIG
// ==================================================

const APP_VERSION = "7.0.6";
const PORT = 8094;

const ROOT_DIR = "/var/www/apexquant-v6";
const DATA_DIR = path.join(ROOT_DIR, "data");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const EXPORT_DIR = path.join(ROOT_DIR, "exports");

const STATE_FILE = path.join(DATA_DIR, "state-v7.json");
const OLD_STATE_FILE = path.join(DATA_DIR, "state-v6.json");
const BRAIN_LOG_FILE = path.join(LOG_DIR, "bot-brain-v7.log");

const PAPER_MODE_ONLY = true;
const GBP_USD_RATE = 0.785;

const DEFAULT_BUY_FEE_GBP = 1;
const DEFAULT_SELL_FEE_GBP = 1;

// ==================================================
// SECTION 3: FOLDERS
// ==================================================

for (const dir of [DATA_DIR, LOG_DIR, EXPORT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ==================================================
// SECTION 4: PAIRS
// ==================================================

const TOP_50_PAIRS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
  "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "TRXUSDT",
  "LINKUSDT", "LTCUSDT", "UNIUSDT", "NEARUSDT", "APTUSDT",
  "ATOMUSDT", "ETCUSDT", "ICPUSDT", "FILUSDT", "XLMUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "IMXUSDT", "GRTUSDT",
  "STXUSDT", "INJUSDT", "ALGOUSDT", "SEIUSDT", "TIAUSDT",
  "PEPEUSDT", "FETUSDT", "RUNEUSDT", "PYTHUSDT", "JUPUSDT",
  "WIFUSDT", "WLDUSDT", "AAVEUSDT", "LDOUSDT", "SANDUSDT",
  "MANAUSDT", "FLOWUSDT", "DYDXUSDT", "ORDIUSDT", "ARKMUSDT",
  "BCHUSDT"
];

// ==================================================
// SECTION 5: DEFAULT SETTINGS
// ==================================================

const DEFAULT_SETTINGS = {
  paperMode: true,
  liveModeLocked: true,

  pairMode: "TOP_50",
  customPairs: [],

  buyFeeGbp: DEFAULT_BUY_FEE_GBP,
  sellFeeGbp: DEFAULT_SELL_FEE_GBP,
  slippageAllowancePercent: 0.05,
  maxSpreadPercent: 0.15,

  engines: {
    scalpEnabled: true,
    strategyEnabled: true,
    smartAllocationMode: false
  },

  scalp: {
    startingBalanceGbp: 10000,
    tradeSizeGbp: 2000,
    maxUsableCapitalPercent: 100,
    maxOpenTrades: 1,

    scalpProfile: "BALANCED", // STRICT, BALANCED, AGGRESSIVE

    dailyTargetGbp: 200,
    minimumNetProfitGbp: 6,
    idealNetProfitGbp: 8,
    maxQuickWinGbp: 12,

    trueProfitLockGbp: 1.25,
    trailActivationNetGbp: 3,

    dynamicStopMinGbp: 5,
    dynamicStopMaxGbp: 14,

    normalMaxLossGbp: 8,
    highConfidenceMaxLossGbp: 12,
    maxDailyLossPercent: 3,

    allowLong: true,
    allowShort: true,
    reinvestPercent: 50
  },

  strategy: {
    startingBalanceGbp: 10000,
    tradeSizeGbp: 2000,
    maxUsableCapitalPercent: 100,
    maxOpenTrades: 5,

    dailyTargetGbp: 200,
    targetNetProfitGbp: 30,
    minimumNetProfitGbp: 10,
    trailActivationNetGbp: 20,
    profitLockNetGbp: 10,
    maxLossPerTradePercent: 2,
    maxDailyLossPercent: 5,

    allowLong: true,
    allowShort: true,
    reinvestPercent: 50
  },

  reinvestment: {
    source: "SEPARATE_POTS",
    scalpReinvestPercent: 50,
    strategyReinvestPercent: 50
  },

  tax: {
    taxBracketPercent: 20,
    dateFormat: "dd/mm/yy"
  }
};

// ==================================================
// SECTION 6: STATE
// ==================================================

let state = null;

function createPortfolio(id, start) {
  return {
    id,
    name: id === "scalp" ? "Scalp Pot" : "Strategy Pot",
    startingBalanceGbp: start,
    availableBalanceGbp: start,
    investedAmountGbp: 0,
    realisedPnlGbp: 0,
    openPnlGbp: 0,
    totalValueGbp: start,
    openTrades: [],
    closedTrades: [],
    dailyPnlGbp: 0,
    dailyTrades: 0
  };
}

function createFreshState() {
  return {
    version: APP_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),

    engine: {
      running: false,
      paused: true,
      mode: "PAPER",
      reason: "V7 test engine paused"
    },

    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),

    market: {
      feedStatus: "starting",
      websocketConnected: false,
      lastPriceUpdate: null,
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
    learningApplications: [],

    scalpSafety: {
      pairCooldownUntil: {},
      pairLossesToday: {},
      consecutiveLosses: 0,
      portfolioCooldownUntil: 0,
      signalConfirmations: {},
      lastSignalSeenAt: {}
    }
  };
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    brainLog("system", "Loaded V7 state");
    return;
  }

  if (fs.existsSync(OLD_STATE_FILE)) {
    const old = JSON.parse(fs.readFileSync(OLD_STATE_FILE, "utf8"));
    state = createFreshState();

    state.settings = { ...DEFAULT_SETTINGS, ...(old.settings || {}) };
    state.portfolios = old.portfolios || state.portfolios;
    state.prices = old.prices || {};
    state.priceHistory = old.priceHistory || {};
    state.trades = old.recentTrades || old.trades || [];
    state.whatIf = old.whatIf || [];
    state.brain = [];

    state.version = APP_VERSION;
    state.engine.running = false;
    state.engine.paused = true;
    state.engine.reason = "V7 imported V6 state and paused safely";

    saveState();
    brainLog("system", "Imported V6 state into V7 test file");
    return;
  }

  state = createFreshState();
  saveState();
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ==================================================
// SECTION 7: BRAIN LOG
// ==================================================

function brainLog(type, message, extra = {}) {
  const entry = {
    time: new Date().toISOString(),
    type,
    message,
    ...extra
  };

  if (state?.brain) {
    state.brain.unshift(entry);
    state.brain = state.brain.slice(0, 300);
  }

  fs.appendFileSync(BRAIN_LOG_FILE, JSON.stringify(entry) + "\n");
  console.log(`[BRAIN V7] ${type}: ${message}`);
}

// ==================================================
// SECTION 8: PAIR SELECTION
// ==================================================

function getActivePairs() {
  const mode = state.settings.pairMode;

  if (mode === "TOP_10") return TOP_50_PAIRS.slice(0, 10);
  if (mode === "TOP_20") return TOP_50_PAIRS.slice(0, 20);
  if (mode === "CUSTOM" && state.settings.customPairs?.length) {
    return state.settings.customPairs.map(p => String(p).toUpperCase().trim()).filter(Boolean);
  }

  return TOP_50_PAIRS.slice(0, 50);
}

// ==================================================
// SECTION 9: BINANCE WEBSOCKET
// ==================================================

let binanceWs = null;
let reconnectTimer = null;

function startBinanceFeed() {
  const pairs = getActivePairs();
  const streams = pairs.map(p => `${p.toLowerCase()}@ticker`).join("/");
  const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

  brainLog("feed", `V7 connecting Binance WebSocket for ${pairs.length} pairs`);

  if (binanceWs) {
    try { binanceWs.close(); } catch (_) {}
  }

  binanceWs = new WebSocket(url);

  binanceWs.on("open", () => {
    state.market.feedStatus = "connected";
    state.market.websocketConnected = true;
    brainLog("feed", "V7 Binance WebSocket connected");
    broadcast({ type: "state", payload: publicState() });
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
      state.priceHistory[symbol].push({ price, volume, time: Date.now() });
      state.priceHistory[symbol] = state.priceHistory[symbol].slice(-1000);

      state.market.lastPriceUpdate = Date.now();
      state.market.messageCount++;
    } catch (err) {
      brainLog("feed_error", "WebSocket parse error", { error: err.message });
    }
  });

  binanceWs.on("close", () => {
    state.market.feedStatus = "closed";
    state.market.websocketConnected = false;
    scheduleReconnect();
  });

  binanceWs.on("error", err => {
    state.market.feedStatus = "error";
    state.market.websocketConnected = false;
    brainLog("feed_error", err.message);
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
  return state.market.lastPriceUpdate && Date.now() - state.market.lastPriceUpdate < 15000;
}

// ==================================================
// SECTION 10: MATH HELPERS
// ==================================================

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function money(n) {
  return `£${round2(n).toFixed(2)}`;
}

function estimateFeesGbp(exitCount = 1) {
  return state.settings.buyFeeGbp + state.settings.sellFeeGbp * exitCount;
}

function trueCostBufferGbp(exitCount = 1) {
  const fees = estimateFeesGbp(exitCount);
  const slippage = 2 * (state.settings.slippageAllowancePercent / 100);
  return fees + slippage;
}

function calculatePnlGbp(trade, currentPrice) {
  const direction = trade.side === "LONG" ? 1 : -1;
  const priceMove = (currentPrice - trade.entryPrice) * direction;
  const units = trade.sizeGbp / trade.entryPrice;
  const grossUsd = priceMove * units;
  const grossGbp = grossUsd * GBP_USD_RATE;
  const fees = estimateFeesGbp(trade.exitCount || 1);
  return {
    grossGbp: round2(grossGbp),
    feesGbp: round2(fees),
    netGbp: round2(grossGbp - fees)
  };
}

function priceForNetPnl(trade, targetNetGbp) {
  const units = trade.sizeGbp / trade.entryPrice;
  const grossNeededGbp = targetNetGbp + estimateFeesGbp(trade.exitCount || 1);
  const grossNeededUsd = grossNeededGbp / GBP_USD_RATE;
  const priceMove = grossNeededUsd / units;
  return trade.side === "LONG"
    ? trade.entryPrice + priceMove
    : trade.entryPrice - priceMove;
}

// ==================================================
// SECTION 11: INDICATORS
// ==================================================

function getHistory(symbol, limit = 100) {
  return (state.priceHistory[symbol] || []).slice(-limit);
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
  const variance = prices.reduce((s, p) => s + Math.pow(p - avg, 2), 0) / prices.length;
  return (Math.sqrt(variance) / avg) * 100;
}

function supportResistance(symbol, lookback = 100) {
  const hist = getHistory(symbol, lookback);
  if (hist.length < 20) return { support: null, resistance: null, confidence: 0 };

  const prices = hist.map(x => x.price);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  const range = high - low;

  return {
    support: low + range * 0.1,
    resistance: high - range * 0.1,
    confidence: range > 0 ? Math.min(100, Math.round((range / prices.at(-1)) * 10000)) : 0
  };
}

function bollinger(symbol, lookback = 30) {
  const hist = getHistory(symbol, lookback);
  if (hist.length < lookback) return { ready: false };

  const prices = hist.map(x => x.price);
  const mid = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + Math.pow(p - mid, 2), 0) / prices.length;
  const sd = Math.sqrt(variance);
  const upper = mid + sd * 2;
  const lower = mid - sd * 2;
  const widthPercent = ((upper - lower) / mid) * 100;
  const current = prices.at(-1);

  return {
    ready: true,
    upper,
    lower,
    mid,
    widthPercent,
    squeeze: widthPercent < 0.18,
    position: current >= upper * 0.995 ? "UPPER" : current <= lower * 1.005 ? "LOWER" : "MIDDLE"
  };
}

function btcRegime() {
  const mom20 = momentumPercent("BTCUSDT", 20);
  const vol = volatilityPercent("BTCUSDT", 30);

  if (mom20 <= -1.5 && vol > 0.5) return "BTC_RISK_OFF";
  if (mom20 >= 1) return "BTC_BULLISH";
  if (Math.abs(mom20) < 0.3) return "BTC_CHOP";
  if (mom20 < 0) return "BTC_WEAK";
  return "BTC_NEUTRAL";
}

// ==================================================
// SECTION 12: WHATIF LEARNING
// ==================================================

const SCALP_INTERVALS = [
  { key: "m1", label: "1m", ms: 60_000 },
  { key: "m3", label: "3m", ms: 180_000 },
  { key: "m5", label: "5m", ms: 300_000 },
  { key: "m10", label: "10m", ms: 600_000 },
  { key: "m15", label: "15m", ms: 900_000 },
  { key: "m20", label: "20m", ms: 1_200_000 }
];

const STRATEGY_INTERVALS = [
  { key: "m20", label: "20m", ms: 1_200_000 },
  { key: "h1", label: "1h", ms: 3_600_000 },
  { key: "h4", label: "4h", ms: 14_400_000 },
  { key: "h24", label: "24h", ms: 86_400_000 }
];

function whatIfIntervalsForPot(pot) {
  return pot === "scalp" ? SCALP_INTERVALS : STRATEGY_INTERVALS;
}

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
    bestFutureNetGbp: null,
    worstFutureNetGbp: null,
    optimalDifferenceGbp: 0,
    lesson: "Tracking started",
    usedByBot: false,
    usedByBotMessage: ""
  };

  for (const item of whatIfIntervalsForPot(trade.pot)) {
    tracker.intervals[item.key] = {
      label: item.label,
      checked: false,
      price: null,
      netPnlGbp: null,
      differenceVsActualGbp: null
    };
  }

  state.whatIf.unshift(tracker);
  state.whatIf = state.whatIf.slice(0, 500);
}

function updateWhatIfTrackers() {
  const now = Date.now();

  for (const tracker of state.whatIf) {
    const price = state.prices[tracker.symbol]?.price;
    if (!price) continue;

    for (const item of whatIfIntervalsForPot(tracker.pot)) {
      const row = tracker.intervals[item.key];
      if (!row || row.checked) continue;

      if (now - tracker.closeTime >= item.ms) {
        const fakeTrade = {
          side: tracker.side,
          entryPrice: tracker.entryPrice,
          sizeGbp: 2000,
          exitCount: 1
        };

        const pnl = calculatePnlGbp(fakeTrade, price);

        row.checked = true;
        row.price = price;
        row.netPnlGbp = pnl.netGbp;
        row.differenceVsActualGbp = round2(pnl.netGbp - tracker.actualNetPnlGbp);
      }
    }

    rebuildWhatIfLesson(tracker);
  }
}

function rebuildWhatIfLesson(tracker) {
  const checked = Object.values(tracker.intervals || {}).filter(x => x.checked);
  if (!checked.length) {
    tracker.lesson = "Waiting for future price checks";
    return;
  }

  const best = checked.reduce((a, b) => b.netPnlGbp > a.netPnlGbp ? b : a, checked[0]);
  const worst = checked.reduce((a, b) => b.netPnlGbp < a.netPnlGbp ? b : a, checked[0]);

  tracker.bestFutureNetGbp = best.netPnlGbp;
  tracker.worstFutureNetGbp = worst.netPnlGbp;
  tracker.optimalDifferenceGbp = round2(best.netPnlGbp - tracker.actualNetPnlGbp);

  if (tracker.optimalDifferenceGbp > 3) {
    tracker.lesson = `Exit may have been early. Best later result was ${best.label}, improving by ${money(tracker.optimalDifferenceGbp)}.`;
  } else if (tracker.optimalDifferenceGbp < -3) {
    tracker.lesson = `Good exit. Holding later would have reduced result by ${money(Math.abs(tracker.optimalDifferenceGbp))}.`;
  } else {
    tracker.lesson = "Exit timing was reasonable.";
  }
}

function learningAgeWeight(closeTime) {
  const ageDays = (Date.now() - closeTime) / 86_400_000;
  if (ageDays <= 1) return 1;
  if (ageDays <= 3) return 0.75;
  if (ageDays <= 7) return 0.5;
  if (ageDays <= 14) return 0.25;
  return 0.1;
}

function getLearningFor(symbol, pot) {
  const rows = state.whatIf
    .filter(w => w.symbol === symbol && w.pot === pot)
    .slice(0, 30);

  if (!rows.length) {
    return { bias: "NEUTRAL", confidenceBoost: 0, targetAdjustGbp: 0, message: "No WhatIf learning yet" };
  }

  let weightedImprovement = 0;
  let totalWeight = 0;

  for (const row of rows) {
    const weight = learningAgeWeight(row.closeTime);
    weightedImprovement += (row.optimalDifferenceGbp || 0) * weight;
    totalWeight += weight;
  }

  const avg = totalWeight ? weightedImprovement / totalWeight : 0;

  if (avg > 5) {
    return {
      bias: "HOLD_WINNERS_SLIGHTLY",
      confidenceBoost: 4,
      targetAdjustGbp: 2,
      message: `${symbol} ${pot} WhatIf says recent exits were early. Weighted improvement ${money(avg)}.`
    };
  }

  if (avg < -5) {
    return {
      bias: "TAKE_PROFIT_FASTER",
      confidenceBoost: 2,
      targetAdjustGbp: -1,
      message: `${symbol} ${pot} WhatIf says fast exits protected profit. Weighted damage avoided ${money(Math.abs(avg))}.`
    };
  }

  return {
    bias: "NEUTRAL",
    confidenceBoost: 0,
    targetAdjustGbp: 0,
    message: `${symbol} ${pot} WhatIf is mixed. Weighted difference ${money(avg)}.`
  };
}

// ==================================================
// SECTION 13: SCALP BRAIN
// ==================================================

function dynamicScalpStopGbp(symbol) {
  const vol = volatilityPercent(symbol, 30);

  const min = Number(state.settings.scalp.dynamicStopMinGbp || 5);
  const max = Number(state.settings.scalp.dynamicStopMaxGbp || 14);

  // If volatility is not ready yet, never return zero.
  if (!vol || vol <= 0) {
    return min;
  }

  const proposed = 5 + vol * 35;
  return round2(Math.max(min, Math.min(max, proposed)));
}
function evaluateScalp(symbol) {
  const priceObj = state.prices[symbol];
  if (!priceObj) return review(symbol, "scalp", "WAIT", "No live price yet", 0);

  const settings = state.settings.scalp;
  const price = priceObj.price;
  const sr = supportResistance(symbol);
  const bb = bollinger(symbol);
  const btc = btcRegime();

  const mom3 = momentumPercent(symbol, 3);
  const mom5 = momentumPercent(symbol, 5);
  const mom20 = momentumPercent(symbol, 20);
  const vol = volatilityPercent(symbol, 30);
  const learning = getLearningFor(symbol, "scalp");

  let longScore = 0;
  let shortScore = 0;
  const notes = [];

  // Micro momentum
  if (mom3 > 0.005) { longScore += 8; notes.push("tiny upward tick"); }
  if (mom3 < -0.005) { shortScore += 8; notes.push("tiny downward tick"); }

  if (mom5 > 0.015) { longScore += 14; notes.push("short momentum rising"); }
  if (mom5 < -0.015) { shortScore += 14; notes.push("short momentum falling"); }

  if (mom20 > 0.04) { longScore += 10; notes.push("20-tick trend up"); }
  if (mom20 < -0.04) { shortScore += 10; notes.push("20-tick trend down"); }

  // Support/resistance context
  if (sr.support && price <= sr.support * 1.006) {
    longScore += 10;
    notes.push("near support");
  }

  if (sr.resistance && price >= sr.resistance * 0.994) {
    shortScore += 10;
    notes.push("near resistance");
  }

  // Bollinger context
  if (bb.ready && bb.squeeze && Math.abs(mom5) > 0.01) {
    if (mom5 > 0) longScore += 8;
    if (mom5 < 0) shortScore += 8;
    notes.push("Bollinger squeeze pressure");
  }

  if (bb.ready && bb.position === "LOWER" && mom3 > 0) {
    longScore += 8;
    notes.push("lower band bounce");
  }

  if (bb.ready && bb.position === "UPPER" && mom3 < 0) {
    shortScore += 8;
    notes.push("upper band rejection");
  }

  // BTC regime
  if (btc === "BTC_BULLISH") {
    longScore += 8;
    notes.push("BTC supportive");
  }

  if (btc === "BTC_WEAK") {
    shortScore += 8;
    notes.push("BTC weak");
  }

  if (btc === "BTC_RISK_OFF") {
    shortScore += 12;
    longScore -= 12;
    notes.push("BTC risk-off");
  }

  if (btc === "BTC_CHOP") {
    longScore -= 4;
    shortScore -= 4;
    notes.push("BTC choppy");
  }

  // Movement quality
  if (vol < 0.005) {
    longScore -= 12;
    shortScore -= 12;
    notes.push("movement too low");
  }

  if (vol >= 0.02) {
    longScore += 4;
    shortScore += 4;
    notes.push("enough movement for scalp");
  }

  const bestSide = longScore >= shortScore ? "LONG" : "SHORT";
  const bestScore = Math.max(longScore, shortScore);

  let signal = bestSide;
  let confidence = Math.max(0, Math.min(95, Math.round(45 + bestScore + learning.confidenceBoost)));

  const expectedNet = estimateExpectedNetProfitGbp(symbol, settings.tradeSizeGbp, "scalp");

  if (expectedNet >= 10 && bestScore >= 22) {
    confidence = Math.max(confidence, 72);
  }

  if (expectedNet >= 15 && bestScore >= 22) {
    confidence = Math.max(confidence, 76);
  }

  let reason = "Scalp " + signal + ": " + (notes.join(", ") || "watching") + "; " + learning.message;

  if (!state.settings.engines.scalpEnabled) {
    signal = "HOLD";
    confidence = 0;
    reason = "Scalp engine disabled in settings";
  }

  if (expectedNet < settings.minimumNetProfitGbp) {
    signal = "REJECT";
    confidence = Math.min(confidence, 45);
    reason = "Expected net " + money(expectedNet) + " below scalp minimum " + money(settings.minimumNetProfitGbp);
  }

  // V7.0.3: allow real testing, but still avoid weak noise.
  if (bestScore < 22) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = "No scalp entry yet. Pattern score " + bestScore + ". " + (notes.join(", ") || "No clear setup");
  }

  const data = review(symbol, "scalp", signal, reason, confidence, {
    price,
    strategy: "V7.0.3 Balanced WhatIf Scalp Brain",
    expectedNetGbp: round2(expectedNet),
    support: sr.support,
    resistance: sr.resistance,
    btcRegime: btc,
    momentum3: round2(mom3),
    momentum5: round2(mom5),
    momentum20: round2(mom20),
    volatility: round2(vol),
    dynamicStopGbp: dynamicScalpStopGbp(symbol),
    scalpScore: bestScore,
    learningBias: learning.bias,
    learningAppliedMessage: learning.message
  });

  const risk = canOpenTrade("scalp", data);
  data.canBuy = risk.ok;
  data.whyNotBuying = risk.reason;

  return data;
}
// ==================================================
// SECTION 14: STRATEGY BRAIN
// ==================================================

function evaluateStrategy(symbol) {
  const priceObj = state.prices[symbol];
  if (!priceObj) return review(symbol, "strategy", "WAIT", "No live price yet", 0);

  const settings = state.settings.strategy;
  const price = priceObj.price;
  const sr = supportResistance(symbol);
  const btc = btcRegime();
  const mom5 = momentumPercent(symbol, 5);
  const mom20 = momentumPercent(symbol, 20);
  const vol = volatilityPercent(symbol, 30);
  const learning = getLearningFor(symbol, "strategy");

  let signal = "HOLD";
  let confidence = 50;
  let reason = "Watching market structure";

  const nearSupport = sr.support && price <= sr.support * 1.006;
  const nearResistance = sr.resistance && price >= sr.resistance * 0.994;

  if (nearSupport && mom5 > 0 && settings.allowLong) {
    signal = "LONG";
    confidence = 72;
    reason = "Price near support and momentum improving";
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
    confidence = 35;
    reason = "Long blocked because BTC is risk-off";
  }

  if (!state.settings.engines.strategyEnabled) {
    signal = "HOLD";
    confidence = 0;
    reason = "Strategy engine disabled in settings";
  }

  const expectedNet = estimateExpectedNetProfitGbp(symbol, settings.tradeSizeGbp, "strategy");

  const data = review(symbol, "strategy", signal, reason, confidence, {
    price,
    strategy: "Support/Resistance Trend",
    expectedNetGbp: round2(expectedNet),
    support: sr.support,
    resistance: sr.resistance,
    btcRegime: btc,
    momentum5: round2(mom5),
    momentum20: round2(mom20),
    volatility: round2(vol),
    learningBias: learning.bias,
    learningAppliedMessage: learning.message
  });

  const risk = canOpenTrade("strategy", data);
  data.canBuy = risk.ok;
  data.whyNotBuying = risk.reason;

  return data;
}

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

function estimateExpectedNetProfitGbp(symbol, sizeGbp, pot) {
  const vol = volatilityPercent(symbol, 30);
  const mom3 = Math.abs(momentumPercent(symbol, 3));
  const mom5 = Math.abs(momentumPercent(symbol, 5));
  const mom20 = Math.abs(momentumPercent(symbol, 20));

  let expectedMovePercent;

  if (pot === "scalp") {
    // V7.0.4:
    // Use live micro-movement + volatility.
    // This stops expected net being stuck at £3.
    expectedMovePercent = Math.max(
      0.25,
      (vol * 2.2) +
      (mom3 * 1.8) +
      (mom5 * 1.4) +
      (mom20 * 0.5)
    );
  } else {
    expectedMovePercent = Math.max(0.6, vol * 1.5);
  }

  const expected = sizeGbp * (expectedMovePercent / 100) - estimateFeesGbp(1);

  return round2(expected);
}

// ==================================================
// SECTION 14B: V7 SCALP SAFETY HELPERS - REQUIRED
// ==================================================

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getScalpSafety() {
  if (!state.scalpSafety) {
    state.scalpSafety = {
      pairCooldownUntil: {},
      pairLossesToday: {},
      consecutiveLosses: 0,
      portfolioCooldownUntil: 0,
      signalConfirmations: {},
      lastSignalSeenAt: {}
    };
  }
  return state.scalpSafety;
}

function scalpPairKey(symbol) {
  return todayKey() + "_" + symbol;
}

function scalpCooldownReason(symbol) {
  const safety = getScalpSafety();
  const now = Date.now();

  if (safety.portfolioCooldownUntil && now < safety.portfolioCooldownUntil) {
    const seconds = Math.ceil((safety.portfolioCooldownUntil - now) / 1000);
    return "Scalp portfolio cooldown active for " + seconds + " seconds";
  }

  const until = safety.pairCooldownUntil[symbol] || 0;
  if (until && now < until) {
    const seconds = Math.ceil((until - now) / 1000);
    return symbol + " cooldown active for " + seconds + " seconds";
  }

  return null;
}

function updateScalpSignalConfirmation(reviewData) {
  const safety = getScalpSafety();
  const key = reviewData.symbol + "_" + reviewData.signal;

  if (!["LONG", "SHORT"].includes(reviewData.signal)) {
    return 0;
  }

  safety.signalConfirmations[key] = (safety.signalConfirmations[key] || 0) + 1;
  safety.lastSignalSeenAt[key] = Date.now();

  for (const k of Object.keys(safety.signalConfirmations)) {
    if (k !== key && k.startsWith(reviewData.symbol + "_")) {
      safety.signalConfirmations[k] = 0;
    }

    const lastSeen = safety.lastSignalSeenAt[k] || 0;
    if (Date.now() - lastSeen > 15000) {
      safety.signalConfirmations[k] = 0;
    }
  }

  return safety.signalConfirmations[key];
}

function btcAgreesWithScalp(reviewData) {
  const btc = reviewData.btcRegime || btcRegime();

  if (reviewData.signal === "LONG") {
    return btc === "BTC_BULLISH" || btc === "BTC_NEUTRAL" || btc === "BTC_CHOP";
  }

  if (reviewData.signal === "SHORT") {
    return btc === "BTC_RISK_OFF" || btc === "BTC_WEAK" || btc === "BTC_CHOP";
  }

  return false;
}

function scalpVolumeOk(symbol) {
  const volume = Number(state.prices[symbol]?.volume || 0);
  return volume >= 1000000;
}

function registerScalpClose(trade, netPnlGbp) {
  const safety = getScalpSafety();
  const symbol = trade.symbol;
  const key = scalpPairKey(symbol);

  if (netPnlGbp > 0) {
    safety.consecutiveLosses = 0;
    return;
  }

  safety.consecutiveLosses += 1;
  safety.pairLossesToday[key] = (safety.pairLossesToday[key] || 0) + 1;

  const losses = safety.pairLossesToday[key];

  if (losses === 1) {
    safety.pairCooldownUntil[symbol] = Date.now() + 3 * 60 * 1000;
    brainLog("scalp_guard", symbol + " first scalp loss. Pair cooldown 3 minutes.");
  }

  if (losses === 2) {
    safety.pairCooldownUntil[symbol] = Date.now() + 30 * 60 * 1000;
    brainLog("scalp_guard", symbol + " second scalp loss. Pair cooldown 30 minutes.");
  }

  if (losses >= 3) {
    const tomorrow = new Date();
    tomorrow.setUTCHours(24, 0, 0, 0);
    safety.pairCooldownUntil[symbol] = tomorrow.getTime();
    brainLog("scalp_guard", symbol + " third scalp loss. Pair blocked for the day.");
  }

  if (safety.consecutiveLosses >= 3) {
    safety.portfolioCooldownUntil = Date.now() + 5 * 60 * 1000;
    brainLog("scalp_guard", "Three consecutive scalp losses. Scalp portfolio cooldown 5 minutes.");
  }
}

function scalpProfileRules() {
  const profile = state.settings.scalp.scalpProfile || "BALANCED";

  if (profile === "AGGRESSIVE") {
    return {
      minExpectedNetGbp: 4,
      minConfidence: 68,
      requiredConfirmations: 2,
      label: "AGGRESSIVE"
    };
  }

  if (profile === "STRICT") {
    return {
      minExpectedNetGbp: 8,
      minConfidence: 85,
      requiredConfirmations: 3,
      label: "STRICT"
    };
  }

  return {
    minExpectedNetGbp: 6,
    minConfidence: 70,
    requiredConfirmations: 3,
    label: "BALANCED"
  };
}

// ==================================================
// SECTION 15: RISK ENGINE
// ==================================================


function scalpProfileRules() {
  const profile = state.settings.scalp.scalpProfile || "STRICT";

  if (profile === "AGGRESSIVE") {
    return {
      minExpectedNetGbp: 4,
      minConfidence: 78,
      requiredConfirmations: 2,
      label: "AGGRESSIVE"
    };
  }

  if (profile === "BALANCED") {
    return {
      minExpectedNetGbp: 6,
      minConfidence: 82,
      requiredConfirmations: 3,
      label: "BALANCED"
    };
  }

  return {
    minExpectedNetGbp: 8,
    minConfidence: 85,
    requiredConfirmations: 3,
    label: "STRICT"
  };
}

function canOpenTrade(pot, reviewData) {
  if (!state.engine.running) return { ok: false, reason: "Engine stopped" };
  if (state.engine.paused) return { ok: false, reason: "Paused: no new trades" };
  if (!isPriceFresh()) return { ok: false, reason: "Market feed stale" };

  const portfolio = state.portfolios[pot];
  const settings = state.settings[pot];

  recalcPortfolio(portfolio);

  if (!["LONG", "SHORT"].includes(reviewData.signal)) {
    return { ok: false, reason: "Signal is " + reviewData.signal + ", not LONG/SHORT" };
  }

  if (portfolio.openTrades.some(t => t.symbol === reviewData.symbol)) {
    return { ok: false, reason: "Already has open trade on this pair in this pot" };
  }

  if (settings.maxOpenTrades && portfolio.openTrades.length >= settings.maxOpenTrades) {
    return { ok: false, reason: pot + " max open trades reached" };
  }

  const reinvestPercent = pot === "scalp"
    ? state.settings.reinvestment.scalpReinvestPercent
    : state.settings.reinvestment.strategyReinvestPercent;

  const reinvestOwnProfit = Math.max(0, portfolio.realisedPnlGbp) * (reinvestPercent / 100);
  const usableCapital = settings.startingBalanceGbp + reinvestOwnProfit;

  if (portfolio.investedAmountGbp + settings.tradeSizeGbp > usableCapital) {
    return { ok: false, reason: pot + " capital limit reached. Separate pot protected." };
  }

  if (portfolio.availableBalanceGbp < settings.tradeSizeGbp) {
    return { ok: false, reason: pot + " available balance too low." };
  }

  if (pot === "scalp") {
    if (!state.settings.engines.scalpEnabled) {
      return { ok: false, reason: "Scalp engine disabled" };
    }

    const cooldown = scalpCooldownReason(reviewData.symbol);
    if (cooldown) {
      return { ok: false, reason: cooldown };
    }

    if (!scalpVolumeOk(reviewData.symbol)) {
      return { ok: false, reason: "Scalp blocked: volume too low for fast trading" };
    }

    if (!btcAgreesWithScalp(reviewData)) {
      return { ok: false, reason: "Scalp blocked: BTC does not agree with direction" };
    }

    const profileRules = scalpProfileRules();
    const minimumExpectedNet = profileRules.minExpectedNetGbp;
    if (Number(reviewData.expectedNetGbp || 0) < minimumExpectedNet) {
      return {
        ok: false,
        reason: "Scalp blocked: expected net " + money(reviewData.expectedNetGbp || 0) + " below " + money(minimumExpectedNet)
      };
    }

    const safety = getScalpSafety();
    const profileRules2 = scalpProfileRules();
    const dynamicConfidence = safety.consecutiveLosses >= 2 ? Math.max(90, profileRules2.minConfidence) : profileRules2.minConfidence;

    if (reviewData.confidence < dynamicConfidence) {
      return {
        ok: false,
        reason: "Scalp confidence " + reviewData.confidence + "% below " + dynamicConfidence + "%"
      };
    }

    const confirmations = updateScalpSignalConfirmation(reviewData);
    const requiredConfirmations = scalpProfileRules().requiredConfirmations;

    if (confirmations < requiredConfirmations) {
      return {
        ok: false,
        reason: "Waiting for " + requiredConfirmations + " scalp confirmations. Current confirmation " + confirmations + "/" + requiredConfirmations
      };
    }

    return { ok: true, reason: "Scalp " + scalpProfileRules().label + " setup passed V7.0.2 safety checks" };
  }

  if (pot === "strategy") {
    if (!state.settings.engines.strategyEnabled) {
      return { ok: false, reason: "Strategy engine disabled" };
    }

    if (reviewData.confidence < 70) {
      return { ok: false, reason: "Strategy confidence " + reviewData.confidence + "% below 70%" };
    }

    return { ok: true, reason: "Strategy risk checks passed" };
  }

  return { ok: false, reason: "Unknown pot" };
}

// ==================================================
// SECTION 16: TRADE ENGINE
// ==================================================

function openPaperTrade(pot, reviewData) {
  const portfolio = state.portfolios[pot];
  const settings = state.settings[pot];
  const price = state.prices[reviewData.symbol]?.price;
  if (!price) return null;

  let stopLossNetGbp;

  if (pot === "scalp") {
    const normalLoss = Number(state.settings.scalp.normalMaxLossGbp || 8);
    const highConfidenceLoss = Number(state.settings.scalp.highConfidenceMaxLossGbp || 12);

    // V7.0.6:
    // Scalp is designed for quick £6-£12 wins.
    // It must not allow £20-£30 losses.
    stopLossNetGbp = reviewData.confidence >= 88
      ? -Math.abs(highConfidenceLoss)
      : -Math.abs(normalLoss);
  } else {
    stopLossNetGbp = -(settings.tradeSizeGbp * (settings.maxLossPerTradePercent / 100));
  }

  const trade = {
    id: `T_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    pot,
    symbol: reviewData.symbol,
    side: reviewData.signal,
    strategy: reviewData.strategy,
    entryTime: new Date().toISOString(),
    entryMs: Date.now(),
    entryPrice: price,
    currentPrice: price,
    sizeGbp: settings.tradeSizeGbp,
    status: "OPEN",
    confidence: reviewData.confidence,
    reasonEntry: reviewData.reason,

    buyFeeGbp: state.settings.buyFeeGbp,
    estimatedSellFeeGbp: state.settings.sellFeeGbp,
    exitCount: 1,

    stopLossNetGbp,
    targetNetGbp: pot === "scalp" ? state.settings.scalp.idealNetProfitGbp : state.settings.strategy.targetNetProfitGbp,
    trailActivationNetGbp: settings.trailActivationNetGbp,
    profitLockNetGbp: pot === "scalp" ? state.settings.scalp.trueProfitLockGbp : state.settings.strategy.profitLockNetGbp,

    peakNetPnlGbp: -estimateFeesGbp(1),
    lockedProfitGbp: 0,
    trailingStopPrice: null,
    trueProfitPrice: priceForNetPnl({ side: reviewData.signal, entryPrice: price, sizeGbp: settings.tradeSizeGbp, exitCount: 1 }, trueCostBufferGbp(1)),
    highestPrice: price,
    lowestPrice: price,

    whatIfUsed: reviewData.learningAppliedMessage || "No learning applied",
    botThinking: "Opened in paper mode after separate pot risk checks",

    pnl: {
      grossGbp: 0,
      feesGbp: estimateFeesGbp(1),
      netGbp: -estimateFeesGbp(1)
    }
  };

  portfolio.availableBalanceGbp = round2(portfolio.availableBalanceGbp - settings.tradeSizeGbp);
  portfolio.investedAmountGbp = round2(portfolio.investedAmountGbp + settings.tradeSizeGbp);
  portfolio.openTrades.push(trade);

  state.learningApplications.unshift({
    time: new Date().toISOString(),
    tradeId: trade.id,
    symbol: trade.symbol,
    pot,
    message: trade.whatIfUsed
  });

  brainLog("trade_open", `${pot.toUpperCase()} opened ${trade.side} ${trade.symbol}`, {
    tradeId: trade.id,
    whatIfUsed: trade.whatIfUsed
  });

  return trade;
}

function closePaperTrade(tradeId, reason, panic = false) {
  for (const pot of ["scalp", "strategy"]) {
    const portfolio = state.portfolios[pot];
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
    portfolio.availableBalanceGbp = round2(portfolio.availableBalanceGbp + trade.sizeGbp + pnl.netGbp);
    portfolio.investedAmountGbp = round2(portfolio.investedAmountGbp - trade.sizeGbp);
    portfolio.realisedPnlGbp = round2(portfolio.realisedPnlGbp + pnl.netGbp);
    portfolio.dailyPnlGbp = round2(portfolio.dailyPnlGbp + pnl.netGbp);
    portfolio.dailyTrades++;

    state.trades.unshift(trade);
    state.trades = state.trades.slice(0, 1000);

    createWhatIfTracker(trade);

    brainLog("trade_close", `${pot.toUpperCase()} closed ${trade.symbol}: ${reason}`, {
      tradeId,
      netPnlGbp: pnl.netGbp,
      panicSell: panic
    });

    if (pot === "scalp") {
      registerScalpClose(trade, pnl.netGbp);
    }

    return trade;
  }

  return null;
}

// ==================================================
// SECTION 17: TRAILING + EXIT ENGINE
// ==================================================

function updateTrailingStop(trade) {
  const pot = trade.pot;
  const settings = state.settings[pot];
  const net = trade.pnl.netGbp;

  trade.highestPrice = Math.max(trade.highestPrice || trade.currentPrice, trade.currentPrice);
  trade.lowestPrice = Math.min(trade.lowestPrice || trade.currentPrice, trade.currentPrice);

  if (net > trade.peakNetPnlGbp) trade.peakNetPnlGbp = net;

  if (pot === "scalp") {
    const trueProfitLock = Math.max(state.settings.scalp.trueProfitLockGbp, trueCostBufferGbp(1) - estimateFeesGbp(1));

    if (net >= state.settings.scalp.trailActivationNetGbp) {
      const lockNet = Math.max(trueProfitLock, Math.min(net - 1.25, state.settings.scalp.idealNetProfitGbp));
      const lockPrice = priceForNetPnl(trade, lockNet);

      if (!trade.trailingStopPrice) trade.trailingStopPrice = lockPrice;
      else if (trade.side === "LONG") trade.trailingStopPrice = Math.max(trade.trailingStopPrice, lockPrice);
      else trade.trailingStopPrice = Math.min(trade.trailingStopPrice, lockPrice);

      trade.lockedProfitGbp = Math.max(trade.lockedProfitGbp || 0, lockNet);
    }

    return;
  }

  if (net >= settings.trailActivationNetGbp) {
    const lockNet = Math.max(settings.profitLockNetGbp, net - 10);
    const lockPrice = priceForNetPnl(trade, lockNet);

    if (!trade.trailingStopPrice) trade.trailingStopPrice = lockPrice;
    else if (trade.side === "LONG") trade.trailingStopPrice = Math.max(trade.trailingStopPrice, lockPrice);
    else trade.trailingStopPrice = Math.min(trade.trailingStopPrice, lockPrice);

    trade.lockedProfitGbp = Math.max(trade.lockedProfitGbp || 0, lockNet);
  }
}

function hitTrailingStop(trade) {
  if (!trade.trailingStopPrice) return false;
  return trade.side === "LONG"
    ? trade.currentPrice <= trade.trailingStopPrice
    : trade.currentPrice >= trade.trailingStopPrice;
}

function evaluateOpenTrades() {
  for (const pot of ["scalp", "strategy"]) {
    const portfolio = state.portfolios[pot];

    for (const trade of [...portfolio.openTrades]) {
      const price = state.prices[trade.symbol]?.price;
      if (!price) continue;

      trade.currentPrice = price;
      trade.pnl = calculatePnlGbp(trade, price);
      updateTrailingStop(trade);

      const net = trade.pnl.netGbp;

      if (pot === "scalp" && net <= -6) {
        const moveAgainst =
          (trade.side === "LONG" && momentumPercent(trade.symbol, 3) < -0.005) ||
          (trade.side === "SHORT" && momentumPercent(trade.symbol, 3) > 0.005);

        if (moveAgainst) {
          trade.botThinking = "Scalp defensive exit. Loss reached £6 and momentum is against trade.";
          closePaperTrade(trade.id, "Scalp defensive exit before max loss");
          continue;
        }
      }

      if (net <= trade.stopLossNetGbp) {
        trade.botThinking = `Dynamic stop hit at ${money(net)}. Closing to protect ${pot} pot.`;
        closePaperTrade(trade.id, "Dynamic stop loss hit");
        continue;
      }

      if (hitTrailingStop(trade)) {
        trade.botThinking = `Profit-safe trailing stop hit. Locked approx ${money(trade.lockedProfitGbp)}.`;
        closePaperTrade(trade.id, "Profit-safe trailing stop hit");
        continue;
      }

      if (pot === "scalp") {
        const learning = getLearningFor(trade.symbol, "scalp");
        const target = Math.max(
          state.settings.scalp.minimumNetProfitGbp,
          Math.min(state.settings.scalp.maxQuickWinGbp, state.settings.scalp.idealNetProfitGbp + learning.targetAdjustGbp)
        );

        const marketStillGood =
          (trade.side === "LONG" && momentumPercent(trade.symbol, 3) > 0.01) ||
          (trade.side === "SHORT" && momentumPercent(trade.symbol, 3) < -0.01);

        if (net >= target && learning.bias !== "HOLD_WINNERS_SLIGHTLY") {
          trade.botThinking = `Scalp quick win taken. Net ${money(net)}. Target ${money(target)}.`;
          closePaperTrade(trade.id, "Scalp quick win");
          continue;
        }

        if (net >= target && learning.bias === "HOLD_WINNERS_SLIGHTLY" && !marketStillGood) {
          trade.botThinking = `WhatIf suggested holding, but momentum faded. Taking ${money(net)}.`;
          closePaperTrade(trade.id, "Scalp WhatIf hold cancelled by market");
          continue;
        }

        trade.botThinking = `Scalp monitoring. Net ${money(net)}. Target ${money(target)}. Trail ${trade.trailingStopPrice || "not active"}. WhatIf: ${learning.message}`;
        continue;
      }

      if (net >= trade.targetNetGbp) {
        const decision = shouldHoldStrategyWinner(trade);
        if (!decision.hold) {
          trade.botThinking = decision.reason;
          closePaperTrade(trade.id, "Strategy take profit");
          continue;
        }
        trade.botThinking = decision.reason;
      } else {
        trade.botThinking = `Strategy holding. Net ${money(net)}. Target ${money(trade.targetNetGbp)}. Trail ${trade.trailingStopPrice || "not active"}.`;
      }
    }

    recalcPortfolio(portfolio);
  }
}

function shouldHoldStrategyWinner(trade) {
  const sr = supportResistance(trade.symbol);
  const mom5 = momentumPercent(trade.symbol, 5);
  const btc = btcRegime();

  if (trade.side === "LONG" && sr.resistance && trade.currentPrice >= sr.resistance * 0.998) {
    return { hold: false, reason: "Taking profit near resistance." };
  }

  if (trade.side === "SHORT" && sr.support && trade.currentPrice <= sr.support * 1.002) {
    return { hold: false, reason: "Taking profit near support." };
  }

  if (trade.side === "LONG" && btc === "BTC_RISK_OFF") {
    return { hold: false, reason: "Taking profit because BTC risk-off." };
  }

  if (trade.side === "LONG" && mom5 > 0.12) {
    return { hold: true, reason: "Strategy winner held. Momentum remains strong." };
  }

  if (trade.side === "SHORT" && mom5 < -0.12) {
    return { hold: true, reason: "Strategy short held. Down momentum remains strong." };
  }

  return { hold: false, reason: "Strategy target hit and momentum not strong enough to hold." };
}

// ==================================================
// SECTION 18: DAILY PERFORMANCE + EXPORTS
// ==================================================

function formatDateUk(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function formatTime(iso) {
  return new Date(iso).toISOString().slice(11, 19);
}

function dailyPerformance() {
  const byDate = {};

  for (const t of state.trades || []) {
    const date = formatDateUk(t.exitTime || t.entryTime);
    if (!byDate[date]) {
      byDate[date] = {
        date,
        scalpPnlGbp: 0,
        strategyPnlGbp: 0,
        totalPnlGbp: 0,
        trades: 0,
        wins: 0,
        feesGbp: 0
      };
    }

    const row = byDate[date];
    const pnl = t.pnl?.netGbp || 0;

    if (t.pot === "scalp") row.scalpPnlGbp += pnl;
    if (t.pot === "strategy") row.strategyPnlGbp += pnl;

    row.totalPnlGbp += pnl;
    row.trades++;
    if (pnl > 0) row.wins++;
    row.feesGbp += t.pnl?.feesGbp || 0;
  }

  return Object.values(byDate).map(r => ({
    ...r,
    scalpPnlGbp: round2(r.scalpPnlGbp),
    strategyPnlGbp: round2(r.strategyPnlGbp),
    totalPnlGbp: round2(r.totalPnlGbp),
    feesGbp: round2(r.feesGbp),
    winRatePercent: r.trades ? round2((r.wins / r.trades) * 100) : 0
  }));
}

function dailyOptimalEstimate() {
  const byDate = {};

  for (const w of state.whatIf || []) {
    const date = formatDateUk(new Date(w.closeTime).toISOString());
    if (!byDate[date]) byDate[date] = { date, actualGbp: 0, optimalGbp: 0, differenceGbp: 0 };

    byDate[date].actualGbp += w.actualNetPnlGbp || 0;
    const best = w.bestFutureNetGbp ?? w.actualNetPnlGbp ?? 0;
    byDate[date].optimalGbp += Math.max(w.actualNetPnlGbp || 0, best);
  }

  return Object.values(byDate).map(r => ({
    date: r.date,
    actualGbp: round2(r.actualGbp),
    optimalGbp: round2(r.optimalGbp),
    differenceGbp: round2(r.optimalGbp - r.actualGbp)
  }));
}

function csvEscape(v) {
  return `"${String(v ?? "").replaceAll('"', '""')}"`;
}

function tradesCsv() {
  const rows = [
    ["Date", "Time", "Pair", "Pot", "Side", "Strategy", "Entry", "Exit", "SizeGBP", "FeesGBP", "GrossPnLGBP", "NetPnLGBP", "Reason", "WhatIfUsed"]
  ];

  for (const t of state.trades || []) {
    rows.push([
      formatDateUk(t.exitTime || t.entryTime),
      formatTime(t.exitTime || t.entryTime),
      t.symbol,
      t.pot,
      t.side,
      t.strategy,
      t.entryPrice,
      t.exitPrice,
      t.sizeGbp,
      t.pnl?.feesGbp,
      t.pnl?.grossGbp,
      t.pnl?.netGbp,
      t.reasonExit,
      t.whatIfUsed
    ]);
  }

  return rows.map(r => r.map(csvEscape).join(",")).join("\n");
}

function dailyCsv() {
  const rows = [["Date", "ScalpPnLGBP", "StrategyPnLGBP", "TotalPnLGBP", "Trades", "WinRatePercent", "FeesGBP"]];
  for (const d of dailyPerformance()) {
    rows.push([d.date, d.scalpPnlGbp, d.strategyPnlGbp, d.totalPnlGbp, d.trades, d.winRatePercent, d.feesGbp]);
  }
  return rows.map(r => r.map(csvEscape).join(",")).join("\n");
}

function whatIfCsv() {
  const rows = [["Date", "Pair", "Pot", "Side", "ActualNetGBP", "BestFutureGBP", "WorstFutureGBP", "OptimalDiffGBP", "Lesson", "UsedByBot"]];
  for (const w of state.whatIf || []) {
    rows.push([
      formatDateUk(new Date(w.closeTime).toISOString()),
      w.symbol,
      w.pot,
      w.side,
      w.actualNetPnlGbp,
      w.bestFutureNetGbp,
      w.worstFutureNetGbp,
      w.optimalDifferenceGbp,
      w.lesson,
      w.usedByBot
    ]);
  }
  return rows.map(r => r.map(csvEscape).join(",")).join("\n");
}

// ==================================================
// SECTION 19: PORTFOLIO CALCS
// ==================================================

function recalcPortfolio(p) {
  p.openPnlGbp = round2(p.openTrades.reduce((s, t) => s + (t.pnl?.netGbp || 0), 0));
  p.investedAmountGbp = round2(p.openTrades.reduce((s, t) => s + t.sizeGbp, 0));
  p.totalValueGbp = round2(p.availableBalanceGbp + p.investedAmountGbp + p.openPnlGbp);
}

function combinedSummary() {
  const s = state.portfolios.scalp;
  const st = state.portfolios.strategy;

  return {
    startingBalanceGbp: s.startingBalanceGbp + st.startingBalanceGbp,
    availableBalanceGbp: round2(s.availableBalanceGbp + st.availableBalanceGbp),
    investedAmountGbp: round2(s.investedAmountGbp + st.investedAmountGbp),
    openPnlGbp: round2(s.openPnlGbp + st.openPnlGbp),
    realisedPnlGbp: round2(s.realisedPnlGbp + st.realisedPnlGbp),
    totalValueGbp: round2(s.totalValueGbp + st.totalValueGbp)
  };
}

// ==================================================
// SECTION 20: ENGINE LOOP
// ==================================================

function engineLoop() {
  try {
    if (!state.engine.running) return;

    const pairs = getActivePairs();
    const reviews = [];

    for (const symbol of pairs) {
      reviews.push(evaluateScalp(symbol));
      reviews.push(evaluateStrategy(symbol));
    }

    state.reviewedPairs = reviews;
    evaluateOpenTrades();
    updateWhatIfTrackers();

    if (!state.engine.paused) {
      const candidates = [];

      if (state.settings.engines.scalpEnabled) {
        const scalp = reviews.filter(r => r.pot === "scalp" && r.canBuy).sort((a, b) => b.confidence - a.confidence)[0];
        if (scalp) candidates.push(scalp);
      }

      if (state.settings.engines.strategyEnabled) {
        const strategy = reviews.filter(r => r.pot === "strategy" && r.canBuy).sort((a, b) => b.confidence - a.confidence)[0];
        if (strategy) candidates.push(strategy);
      }

      for (const c of candidates) {
        openPaperTrade(c.pot, c);
      }
    }

    saveState();
    broadcast({ type: "state", payload: publicState() });
  } catch (err) {
    brainLog("engine_error", err.message);
  }
}

setInterval(engineLoop, 2000);

// ==================================================
// SECTION 21: PUBLIC STATE
// ==================================================

function publicState() {
  recalcPortfolio(state.portfolios.scalp);
  recalcPortfolio(state.portfolios.strategy);

  return {
    version: APP_VERSION,
    paperModeOnly: PAPER_MODE_ONLY,
    dataMode: {
      prices: "REAL_BINANCE_WEBSOCKET",
      trades: "PAPER_SIMULATED",
      realMoney: false
    },
    engine: state.engine,
    market: state.market,
    settings: state.settings,
    portfolios: state.portfolios,
    combined: combinedSummary(),
    reviewedPairs: state.reviewedPairs,
    brain: state.brain.slice(0, 100),
    whatIf: state.whatIf.slice(0, 100),
    scalpWhatIf: state.whatIf.filter(w => w.pot === "scalp").slice(0, 100),
    strategyWhatIf: state.whatIf.filter(w => w.pot === "strategy").slice(0, 100),
    recentTrades: state.trades.slice(0, 100),
    scalpTrades: state.trades.filter(t => t.pot === "scalp").slice(0, 100),
    strategyTrades: state.trades.filter(t => t.pot === "strategy").slice(0, 100),
    learningApplications: state.learningApplications.slice(0, 100),
    dailyPerformance: dailyPerformance(),
    dailyOptimal: dailyOptimalEstimate(),
    prices: state.prices
  };
}

// ==================================================
// SECTION 22: API ROUTES
// ==================================================

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ name: "ApexQuant V7 Test Backend", version: APP_VERSION, port: PORT, mode: "PAPER ONLY" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, version: APP_VERSION, paperModeOnly: PAPER_MODE_ONLY, uptime: process.uptime() });
});

app.get("/api/state", (req, res) => res.json(publicState()));
app.get("/api/settings", (req, res) => res.json(state.settings));

app.post("/api/settings", (req, res) => {
  state.settings = { ...state.settings, ...req.body };
  brainLog("settings", "Settings updated");
  saveState();
  startBinanceFeed();
  res.json({ success: true, settings: state.settings });
});

app.post("/api/start", (req, res) => {
  state.engine.running = true;
  state.engine.paused = false;
  state.engine.reason = "V7 paper engine running";
  brainLog("engine", "V7 started");
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/stop", (req, res) => {
  state.engine.running = false;
  state.engine.reason = "V7 stopped";
  brainLog("engine", "V7 stopped");
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/pause", (req, res) => {
  state.engine.paused = true;
  state.engine.reason = "Paused: monitoring only";
  brainLog("pause", "Paused new trades");
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/resume", (req, res) => {
  state.engine.paused = false;
  state.engine.reason = "Trading resumed";
  brainLog("engine", "Resumed");
  saveState();
  res.json({ success: true, engine: state.engine });
});

app.post("/api/trades/:id/panic-sell", (req, res) => {
  const trade = closePaperTrade(req.params.id, "INSTANT PANIC SELL", true);
  if (!trade) return res.status(404).json({ success: false, error: "Trade not found" });
  saveState();
  broadcast({ type: "state", payload: publicState() });
  res.json({ success: true, instant: true, trade });
});

app.post("/api/close-all", (req, res) => {
  const closed = [];
  for (const pot of ["scalp", "strategy"]) {
    for (const t of [...state.portfolios[pot].openTrades]) {
      const c = closePaperTrade(t.id, "CLOSE ALL", true);
      if (c) closed.push(c);
    }
  }
  saveState();
  res.json({ success: true, closed });
});

app.post("/api/brain/ask", (req, res) => {
  const q = String(req.body.question || "").toLowerCase();
  let answer = "Ask me what I am watching, why I rejected a pair, today's P&L, or WhatIf learning.";

  if (q.includes("watch")) {
    answer = state.reviewedPairs.slice(0, 10).map(r => `${r.symbol} ${r.pot}: ${r.signal} ${r.confidence}% - ${r.reason}`).join("\n");
  }

  if (q.includes("whatif") || q.includes("learning")) {
    answer = state.learningApplications.slice(0, 10).map(x => `${x.symbol} ${x.pot}: ${x.message}`).join("\n") || "No learning applied yet.";
  }

  if (q.includes("today")) {
    answer = JSON.stringify(dailyPerformance()[0] || {}, null, 2);
  }

  res.json({ question: req.body.question, answer });
});

app.get("/api/export/trades.csv", (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=apexquant-trades.csv");
  res.send(tradesCsv());
});

app.get("/api/export/daily.csv", (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=apexquant-daily.csv");
  res.send(dailyCsv());
});

app.get("/api/export/whatif.csv", (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=apexquant-whatif.csv");
  res.send(whatIfCsv());
});

app.get("/api/export/tax.csv", (req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=apexquant-tax.csv");
  res.send(tradesCsv());
});

// ==================================================
// SECTION 23: DASHBOARD WEBSOCKET
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
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ==================================================
// SECTION 24: STARTUP
// ==================================================

loadState();

// V7 startup safety migration
if (!state.settings.engines) {
  state.settings.engines = {
    scalpEnabled: true,
    strategyEnabled: true,
    smartAllocationMode: false
  };
}

if (!state.scalpSafety) {
  state.scalpSafety = {
    pairCooldownUntil: {},
    pairLossesToday: {},
    consecutiveLosses: 0,
    portfolioCooldownUntil: 0,
    signalConfirmations: {},
    lastSignalSeenAt: {}
  };
}

state.settings.scalp.maxOpenTrades = 1;
state.settings.scalp.scalpProfile = "BALANCED";
state.settings.scalp.minimumNetProfitGbp = 6;
state.settings.scalp.idealNetProfitGbp = 8;
state.settings.scalp.maxQuickWinGbp = 12;
state.settings.scalp.normalMaxLossGbp = 8;
state.settings.scalp.highConfidenceMaxLossGbp = 12;
state.version = APP_VERSION;

brainLog("system", "Applied V7.0.3 startup safety migration.");
saveState();

startBinanceFeed();

server.listen(PORT, "0.0.0.0", () => {
  brainLog("system", `ApexQuant V7 test backend running on port ${PORT}`);
  console.log(`ApexQuant V7 test backend running: http://0.0.0.0:${PORT}`);
});
