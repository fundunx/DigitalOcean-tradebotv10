const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7/server-v7-before-candle-engine-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(/const APP_VERSION = "7\.[0-9.]+"/, 'const APP_VERSION = "7.1.0"');

// Add candle storage to fresh state
code = code.replace(
`    prices: {},
    priceHistory: {},`,
`    prices: {},
    priceHistory: {},
    candles: {},`
);

// Add candle update after price history update
code = code.replace(
`      state.market.lastPriceUpdate = Date.now();
      state.market.messageCount++;`,
`      updateCandles(symbol, price, volume);

      state.market.lastPriceUpdate = Date.now();
      state.market.messageCount++;`
);

// Insert candle engine before INDICATORS
const candleEngine = `
// ==================================================
// SECTION 10C: REAL CANDLE ENGINE
// BUILDS 1m / 3m / 5m / 15m CANDLES FROM LIVE BINANCE TICKS
// ==================================================

const CANDLE_TIMEFRAMES = {
  "1m": 60 * 1000,
  "3m": 3 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000
};

function candleBucket(time, timeframe) {
  const ms = CANDLE_TIMEFRAMES[timeframe];
  return Math.floor(time / ms) * ms;
}

function ensureCandleStore(symbol) {
  if (!state.candles) state.candles = {};
  if (!state.candles[symbol]) state.candles[symbol] = {};
  for (const tf of Object.keys(CANDLE_TIMEFRAMES)) {
    if (!state.candles[symbol][tf]) state.candles[symbol][tf] = [];
  }
}

function updateCandles(symbol, price, volume) {
  ensureCandleStore(symbol);

  const now = Date.now();

  for (const tf of Object.keys(CANDLE_TIMEFRAMES)) {
    const bucket = candleBucket(now, tf);
    const candles = state.candles[symbol][tf];
    let current = candles[candles.length - 1];

    if (!current || current.start !== bucket) {
      current = {
        start: bucket,
        end: bucket + CANDLE_TIMEFRAMES[tf],
        open: price,
        high: price,
        low: price,
        close: price,
        volume: Number(volume || 0),
        trades: 1,
        closed: false
      };

      if (candles.length) {
        candles[candles.length - 1].closed = true;
      }

      candles.push(current);
      state.candles[symbol][tf] = candles.slice(-300);
    } else {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
      current.volume += Number(volume || 0);
      current.trades += 1;
    }
  }
}

function getCandles(symbol, timeframe = "1m", limit = 50, closedOnly = false) {
  ensureCandleStore(symbol);
  let rows = state.candles[symbol][timeframe] || [];
  if (closedOnly) rows = rows.filter(c => c.closed);
  return rows.slice(-limit);
}

function candleBody(c) {
  return Math.abs(c.close - c.open);
}

function candleRange(c) {
  return Math.max(0.00000001, c.high - c.low);
}

function isGreen(c) {
  return c.close > c.open;
}

function isRed(c) {
  return c.close < c.open;
}

function upperWick(c) {
  return c.high - Math.max(c.open, c.close);
}

function lowerWick(c) {
  return Math.min(c.open, c.close) - c.low;
}

function candleMomentum(symbol, timeframe = "1m", lookback = 3) {
  const cs = getCandles(symbol, timeframe, lookback + 1);
  if (cs.length < lookback + 1) return 0;

  const first = cs[0].open;
  const last = cs[cs.length - 1].close;

  return ((last - first) / first) * 100;
}

function candleVolatility(symbol, timeframe = "1m", lookback = 20) {
  const cs = getCandles(symbol, timeframe, lookback);
  if (cs.length < 5) return 0;

  const ranges = cs.map(c => ((c.high - c.low) / c.close) * 100);
  return ranges.reduce((a, b) => a + b, 0) / ranges.length;
}

function candleSupportResistance(symbol, timeframe = "5m", lookback = 30) {
  const cs = getCandles(symbol, timeframe, lookback);
  if (cs.length < 5) return { support: null, resistance: null };

  return {
    support: Math.min(...cs.map(c => c.low)),
    resistance: Math.max(...cs.map(c => c.high))
  };
}

function candleVolumeSpike(symbol, timeframe = "1m", lookback = 20) {
  const cs = getCandles(symbol, timeframe, lookback);
  if (cs.length < 5) return false;

  const last = cs[cs.length - 1];
  const prev = cs.slice(0, -1);
  const avg = prev.reduce((s, c) => s + c.volume, 0) / prev.length;

  return avg > 0 && last.volume > avg * 1.5;
}

function detectCandlePattern(symbol) {
  const c1 = getCandles(symbol, "1m", 3);
  const c5 = getCandles(symbol, "5m", 10);

  if (c1.length < 3 || c5.length < 5) {
    return { direction: "NONE", score: 0, notes: ["not enough candles yet"] };
  }

  const a = c1[c1.length - 3];
  const b = c1[c1.length - 2];
  const c = c1[c1.length - 1];

  let longScore = 0;
  let shortScore = 0;
  const notes = [];

  // Three candle continuation
  if (isGreen(a) && isGreen(b) && isGreen(c)) {
    longScore += 18;
    notes.push("three green 1m candles");
  }

  if (isRed(a) && isRed(b) && isRed(c)) {
    shortScore += 18;
    notes.push("three red 1m candles");
  }

  // Engulfing style
  if (isRed(b) && isGreen(c) && c.close > b.open && c.open < b.close) {
    longScore += 16;
    notes.push("bullish engulfing");
  }

  if (isGreen(b) && isRed(c) && c.close < b.open && c.open > b.close) {
    shortScore += 16;
    notes.push("bearish engulfing");
  }

  // Wick rejection
  if (lowerWick(c) > candleBody(c) * 1.8 && isGreen(c)) {
    longScore += 14;
    notes.push("lower wick rejection");
  }

  if (upperWick(c) > candleBody(c) * 1.8 && isRed(c)) {
    shortScore += 14;
    notes.push("upper wick rejection");
  }

  // Breakout above/below recent 5m structure
  const prev5 = c5.slice(0, -1);
  const recentHigh = Math.max(...prev5.map(x => x.high));
  const recentLow = Math.min(...prev5.map(x => x.low));

  if (c.close > recentHigh) {
    longScore += 20;
    notes.push("1m close broke recent 5m high");
  }

  if (c.close < recentLow) {
    shortScore += 20;
    notes.push("1m close broke recent 5m low");
  }

  // Volume confirmation
  if (candleVolumeSpike(symbol, "1m")) {
    if (longScore > shortScore) longScore += 12;
    if (shortScore > longScore) shortScore += 12;
    notes.push("1m volume spike");
  }

  const direction = longScore > shortScore ? "LONG" : shortScore > longScore ? "SHORT" : "NONE";

  return {
    direction,
    score: Math.max(longScore, shortScore),
    longScore,
    shortScore,
    notes
  };
}

function candleTrendAgreement(symbol) {
  const m1 = candleMomentum(symbol, "1m", 3);
  const m5 = candleMomentum(symbol, "5m", 3);
  const m15 = candleMomentum(symbol, "15m", 2);

  if (m1 > 0 && m5 > 0) return { direction: "LONG", score: 15, m1, m5, m15 };
  if (m1 < 0 && m5 < 0) return { direction: "SHORT", score: 15, m1, m5, m15 };

  return { direction: "MIXED", score: 0, m1, m5, m15 };
}
`;

if (!code.includes("SECTION 10C: REAL CANDLE ENGINE")) {
  code = code.replace(
    "// ==================================================\n// SECTION 11: INDICATORS",
    candleEngine + "\n// ==================================================\n// SECTION 11: INDICATORS"
  );
}

// Replace evaluateScalp with candle-driven one
const start = code.indexOf("function evaluateScalp(symbol) {");
const end = code.indexOf("\n}\n\n// ==================================================\n// SECTION 14: STRATEGY BRAIN", start);

if (start === -1 || end === -1) {
  console.error("Could not find evaluateScalp");
  process.exit(1);
}

const newScalp = `function evaluateScalp(symbol) {
  const priceObj = state.prices[symbol];
  if (!priceObj) return review(symbol, "scalp", "WAIT", "No live price yet", 0);

  const settings = state.settings.scalp;
  const price = priceObj.price;

  const pattern = detectCandlePattern(symbol);
  const trend = candleTrendAgreement(symbol);
  const sr = candleSupportResistance(symbol, "5m", 30);
  const btc = btcRegime();
  const learning = getLearningFor(symbol, "scalp");

  const m1 = candleMomentum(symbol, "1m", 3);
  const m5 = candleMomentum(symbol, "5m", 3);
  const vol1 = candleVolatility(symbol, "1m", 20);

  let signal = pattern.direction;
  let score = pattern.score;
  const notes = [...pattern.notes];

  if (signal !== "NONE" && trend.direction === signal) {
    score += trend.score;
    notes.push("1m and 5m trend agree");
  }

  if (signal === "LONG" && sr.support && price <= sr.support * 1.01) {
    score += 10;
    notes.push("long near 5m support");
  }

  if (signal === "SHORT" && sr.resistance && price >= sr.resistance * 0.99) {
    score += 10;
    notes.push("short near 5m resistance");
  }

  if (signal === "LONG" && btc === "BTC_BULLISH") {
    score += 8;
    notes.push("BTC bullish support");
  }

  if (signal === "SHORT" && (btc === "BTC_WEAK" || btc === "BTC_RISK_OFF")) {
    score += 8;
    notes.push("BTC supports short");
  }

  if (btc === "BTC_CHOP") {
    score -= 5;
    notes.push("BTC choppy");
  }

  let confidence = Math.max(0, Math.min(95, Math.round(45 + score + learning.confidenceBoost)));

  const expectedNet = estimateExpectedNetProfitGbp(symbol, settings.tradeSizeGbp, "scalp");

  let reason = "Candle scalp " + signal + ": " + notes.join(", ") + "; " + learning.message;

  if (!state.settings.engines.scalpEnabled) {
    signal = "HOLD";
    confidence = 0;
    reason = "Scalp engine disabled in settings";
  }

  if (signal === "NONE") {
    signal = "HOLD";
    confidence = Math.min(confidence, 45);
    reason = "No candle pattern confirmed yet. " + notes.join(", ");
  }

  if (expectedNet < settings.minimumNetProfitGbp) {
    signal = "REJECT";
    confidence = Math.min(confidence, 50);
    reason = "Expected net " + money(expectedNet) + " below scalp minimum " + money(settings.minimumNetProfitGbp);
  }

  if (score < 35) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = "Candle score too low: " + score + ". " + notes.join(", ");
  }

  const data = review(symbol, "scalp", signal, reason, confidence, {
    price,
    strategy: "V7.1.0 Candle Scalp Engine",
    expectedNetGbp: round2(expectedNet),
    support: sr.support,
    resistance: sr.resistance,
    btcRegime: btc,
    momentum1m: round2(m1),
    momentum5m: round2(m5),
    volatility1m: round2(vol1),
    candlePattern: pattern.direction,
    candleScore: score,
    patternNotes: notes,
    dynamicStopGbp: dynamicScalpStopGbp(symbol),
    learningBias: learning.bias,
    learningAppliedMessage: learning.message
  });

  const risk = canOpenTrade("scalp", data);
  data.canBuy = risk.ok;
  data.whyNotBuying = risk.reason;

  return data;
}`;

code = code.slice(0, start) + newScalp + code.slice(end + 3);

// Expose candles in publicState
code = code.replace(
`    prices: state.prices`,
`    candles: state.candles,
    prices: state.prices`
);

fs.writeFileSync(file, code);

console.log("V7.1.0 candle engine patch applied.");
console.log("Backup created:");
console.log(backup);
