const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v8.js";
const backup = `/var/www/apexquant-v6/backups/v8-server-before-8-2-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(/const APP_VERSION = "8\.[0-9.]+"/, 'const APP_VERSION = "8.2.0"');

/*
==================================================
ADD STRATEGY REGIME HELPER
==================================================
*/

const helper = `

/*
==================================================
V8.2 STRATEGY RECOVERY HELPERS
Restores V7-style strategy behaviour with candle + bid/ask data
==================================================
*/

function strategyMasterRegime() {
  const btc = btcMasterRegime ? btcMasterRegime() : btcRegime();

  const btcM5 = candleMomentum("BTCUSDT", "5m", 3);
  const btcM15 = candleMomentum("BTCUSDT", "15m", 3);
  const ethM5 = candleMomentum("ETHUSDT", "5m", 3);
  const ethM15 = candleMomentum("ETHUSDT", "15m", 3);

  let bull = 0;
  let bear = 0;
  const notes = [];

  if (btcM5 > 0.08) { bull += 20; notes.push("BTC 5m up"); }
  if (btcM15 > 0.04) { bull += 20; notes.push("BTC 15m up"); }
  if (ethM5 > 0.08) { bull += 12; notes.push("ETH 5m up"); }
  if (ethM15 > 0.04) { bull += 12; notes.push("ETH 15m up"); }

  if (btcM5 < -0.08) { bear += 20; notes.push("BTC 5m down"); }
  if (btcM15 < -0.04) { bear += 20; notes.push("BTC 15m down"); }
  if (ethM5 < -0.08) { bear += 12; notes.push("ETH 5m down"); }
  if (ethM15 < -0.04) { bear += 12; notes.push("ETH 15m down"); }

  if (btc === "BULLISH") { bull += 20; notes.push("BTC master bullish"); }
  if (btc === "BEARISH") { bear += 20; notes.push("BTC master bearish"); }
  if (btc === "CHOP") { bull -= 15; bear -= 15; notes.push("BTC chop"); }

  if (bull >= bear + 15) return { direction: "LONG", bull, bear, notes };
  if (bear >= bull + 15) return { direction: "SHORT", bull, bear, notes };

  return { direction: "NEUTRAL", bull, bear, notes };
}

function v82StrategyScore(symbol) {
  const p = state.prices[symbol];
  if (!p) return { signal: "HOLD", score: 0, notes: ["no price"] };

  const price = p.price;
  const sr5 = candleSR(symbol, "5m", 30);
  const sr15 = candleSR(symbol, "15m", 20);
  const regime = strategyMasterRegime();

  const m1 = candleMomentum(symbol, "1m", 5);
  const m5 = candleMomentum(symbol, "5m", 3);
  const m15 = candleMomentum(symbol, "15m", 3);
  const vol5 = candleVolatility(symbol, "5m", 20);
  const sp = spreadOk(symbol, 0.12);

  let long = 0;
  let short = 0;
  const notes = [];

  // V7-style support/resistance trend logic, improved with candles.
  if (sr5.support && price <= sr5.support * 1.01 && m1 > 0) {
    long += 22;
    notes.push("support bounce");
  }

  if (sr5.resistance && price >= sr5.resistance * 0.99 && m1 < 0) {
    short += 22;
    notes.push("resistance rejection");
  }

  if (m5 > 0.08 && m15 > 0.02) {
    long += 28;
    notes.push("5m/15m trend up");
  }

  if (m5 < -0.08 && m15 < -0.02) {
    short += 28;
    notes.push("5m/15m trend down");
  }

  if (sr5.resistance && price > sr5.resistance && m5 > 0) {
    long += 22;
    notes.push("breakout above 5m resistance");
  }

  if (sr5.support && price < sr5.support && m5 < 0) {
    short += 22;
    notes.push("breakdown below 5m support");
  }

  if (sr15.support && price <= sr15.support * 1.015 && m5 > 0) {
    long += 12;
    notes.push("15m support nearby");
  }

  if (sr15.resistance && price >= sr15.resistance * 0.985 && m5 < 0) {
    short += 12;
    notes.push("15m resistance nearby");
  }

  // Master regime should heavily control direction.
  if (regime.direction === "LONG") {
    long += 25;
    short -= 20;
    notes.push("master regime long");
  }

  if (regime.direction === "SHORT") {
    short += 25;
    long -= 20;
    notes.push("master regime short");
  }

  if (regime.direction === "NEUTRAL") {
    long -= 15;
    short -= 15;
    notes.push("master regime neutral");
  }

  if (vol5 < 0.03) {
    long -= 8;
    short -= 8;
    notes.push("low volatility");
  }

  if (!sp.ok) {
    long -= 25;
    short -= 25;
    notes.push(sp.reason);
  } else {
    long += 6;
    short += 6;
    notes.push(sp.reason);
  }

  const signal = long >= short ? "LONG" : "SHORT";
  const score = Math.max(long, short);

  return {
    signal,
    score,
    confidence: Math.max(0, Math.min(95, Math.round(score))),
    longScore: long,
    shortScore: short,
    notes,
    regime: regime.direction,
    regimeBull: regime.bull,
    regimeBear: regime.bear,
    spreadPercent: sp.spreadPercent,
    support: sr5.support,
    resistance: sr5.resistance,
    m1,
    m5,
    m15,
    vol5
  };
}

function currentStrategyBookDirection() {
  const trades = state.portfolios.strategy.openTrades;
  const longs = trades.filter(t => t.side === "LONG").length;
  const shorts = trades.filter(t => t.side === "SHORT").length;

  if (longs > 0 && shorts === 0) return "LONG";
  if (shorts > 0 && longs === 0) return "SHORT";
  if (longs === 0 && shorts === 0) return "EMPTY";
  return "MIXED";
}

function closeStrategyRegimeFlips() {
  const regime = strategyMasterRegime();

  if (regime.direction === "NEUTRAL") return;

  for (const t of [...state.portfolios.strategy.openTrades]) {
    if (t.side !== regime.direction) {
      closeTrade(t.id, "Strategy regime flip exit");
    }
  }
}
`;

if (!code.includes("V8.2 STRATEGY RECOVERY HELPERS")) {
  code = code.replace(
    "/*\n==================================================\nRISK + TRADE ENGINE",
    helper + "\n/*\n==================================================\nRISK + TRADE ENGINE"
  );
}

/*
==================================================
REPLACE EVALUATE STRATEGY
==================================================
*/

const start = code.indexOf("function evaluateStrategy(symbol) {");
const end = code.indexOf("\n}\n\n/*\n==================================================\nRISK + TRADE ENGINE", start);

if (start === -1 || end === -1) {
  console.error("Could not find evaluateStrategy");
  process.exit(1);
}

const newEvaluateStrategy = `function evaluateStrategy(symbol) {
  const p = state.prices[symbol];
  if (!p) return review(symbol, "strategy", "WAIT", "No price yet", 0);

  const s = v82StrategyScore(symbol);
  const ex = expectedNet(symbol, "strategy");

  let signal = s.signal;
  let confidence = s.confidence;
  let reason = "V8.2 strategy " + signal + ": " + s.notes.join(", ");

  if (!state.settings.engines.strategyEnabled) {
    signal = "HOLD";
    confidence = 0;
    reason = "Strategy disabled";
  }

  // Higher quality than V8.1, but not frozen.
  if (s.score < 65 || ex < 25) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = "Strategy not strong enough. Score " + s.score + ", expected " + money(ex) + ": " + s.notes.join(", ");
  }

  // Master regime hard block.
  if (s.regime === "LONG" && signal === "SHORT") {
    signal = "REJECT";
    confidence = 35;
    reason = "Short blocked by LONG master regime";
  }

  if (s.regime === "SHORT" && signal === "LONG") {
    signal = "REJECT";
    confidence = 35;
    reason = "Long blocked by SHORT master regime";
  }

  if (s.regime === "NEUTRAL") {
    signal = "HOLD";
    confidence = Math.min(confidence, 55);
    reason = "Holding because master regime is neutral";
  }

  const data = review(symbol, "strategy", signal, reason, confidence, {
    price: p.price,
    strategy: "V8.2 Recovered V7 Strategy + Candles + Bid/Ask",
    expectedNetGbp: ex,
    support: s.support,
    resistance: s.resistance,
    btcRegime: s.regime,
    spreadPercent: round2(s.spreadPercent),
    strategyScore: s.score,
    longScore: s.longScore,
    shortScore: s.shortScore,
    regimeBull: s.regimeBull,
    regimeBear: s.regimeBear,
    momentum1m: round2(s.m1),
    momentum5m: round2(s.m5),
    momentum15m: round2(s.m15),
    volatility5m: round2(s.vol5)
  });

  const risk = canOpenTrade("strategy", data);
  data.canBuy = risk.ok;
  data.whyNotBuying = risk.reason;
  return data;
}`;

code = code.slice(0, start) + newEvaluateStrategy + code.slice(end + 3);

/*
==================================================
PATCH CAN OPEN TRADE TO PREVENT MIXED STRATEGY BOOK
==================================================
*/

code = code.replace(
`  if (pot === "strategy" && r.confidence < 70) return { ok: false, reason: "Strategy confidence too low" };`,
`  if (pot === "strategy") {
    if (r.confidence < 65) return { ok: false, reason: "Strategy confidence too low" };

    const bookDirection = currentStrategyBookDirection();

    if (bookDirection !== "EMPTY" && bookDirection !== r.signal) {
      return { ok: false, reason: "Strategy book already " + bookDirection + "; mixed book blocked" };
    }
  }`
);

/*
==================================================
PATCH ENGINE LOOP: CLOSE FLIPS, TOP RANKED ONLY
==================================================
*/

code = code.replace(
`    state.reviewedPairs = reviews;
    evaluateOpenTrades();`,
`    state.reviewedPairs = reviews;

    // V8.2: close strategy trades that oppose current master regime.
    closeStrategyRegimeFlips();

    evaluateOpenTrades();`
);

code = code.replace(
`      const strategyCandidates = reviews.filter(r => r.pot === "strategy" && r.canBuy).sort((a, b) => b.confidence - a.confidence).slice(0, Math.max(0, strategySlots));`,
`      const strategyCandidates = reviews
        .filter(r => r.pot === "strategy" && r.canBuy)
        .sort((a, b) => {
          const aRank = (a.strategyScore || 0) + ((a.expectedNetGbp || 0) / 5);
          const bRank = (b.strategyScore || 0) + ((b.expectedNetGbp || 0) / 5);
          return bRank - aRank;
        })
        .slice(0, Math.max(0, strategySlots));`
);

fs.writeFileSync(file, code);

console.log("V8.2 strategy recovery patch applied.");
console.log("Backup created:", backup);
