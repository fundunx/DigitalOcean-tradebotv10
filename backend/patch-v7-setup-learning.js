const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7-setup-learning-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(
  'const APP_VERSION = "7.0.8-whatif-fixed";',
  'const APP_VERSION = "7.0.9-setup-learning";'
);

const helper = `
function bucketNumber(value, steps) {
  const n = Number(value || 0);

  for (const step of steps) {
    if (n <= step.max) return step.label;
  }

  return steps[steps.length - 1].label;
}

function confidenceBucket(conf) {
  return bucketNumber(conf, [
    { max: 50, label: "LOW_CONF" },
    { max: 70, label: "MID_CONF" },
    { max: 85, label: "HIGH_CONF" },
    { max: 100, label: "VERY_HIGH_CONF" }
  ]);
}

function expectedBucket(expected) {
  return bucketNumber(expected, [
    { max: 4, label: "LOW_EXPECTED" },
    { max: 8, label: "MID_EXPECTED" },
    { max: 15, label: "HIGH_EXPECTED" },
    { max: 9999, label: "VERY_HIGH_EXPECTED" }
  ]);
}

function pnlBucket(pnl) {
  if (pnl >= 25) return "BIG_WIN";
  if (pnl >= 8) return "GOOD_WIN";
  if (pnl > 0) return "SMALL_WIN";
  if (pnl <= -20) return "BIG_LOSS";
  if (pnl <= -8) return "LOSS";
  return "SMALL_LOSS";
}

function safeTextKey(value) {
  return String(value || "UNKNOWN")
    .replace(/[^a-zA-Z0-9_\\-]/g, "_")
    .slice(0, 80);
}

function inferSetupType(trade) {
  const text = [
    trade.strategy,
    trade.reasonEntry,
    trade.botThinking,
    trade.whatIfUsed
  ].join(" ").toLowerCase();

  if (text.includes("support")) return "SUPPORT_BOUNCE";
  if (text.includes("resistance")) return "RESISTANCE_REJECT";
  if (text.includes("breakout")) return "BREAKOUT";
  if (text.includes("breakdown")) return "BREAKDOWN";
  if (text.includes("trend")) return "TREND";
  if (text.includes("scalp")) return "SCALP_MOMENTUM";

  return "GENERAL";
}

function inferBtcRegimeFromTrade(trade) {
  if (trade.btcRegime) return trade.btcRegime;

  // fallback from current market if old trade did not store it
  if (typeof btcRegime === "function") return btcRegime();

  return "UNKNOWN_BTC";
}

function setupFingerprintForTrade(trade) {
  const setup = inferSetupType(trade);
  const btc = inferBtcRegimeFromTrade(trade);
  const conf = confidenceBucket(trade.confidence || 0);
  const expected = expectedBucket(trade.expectedNetGbp || trade.targetNetGbp || 0);

  return [
    safeTextKey(trade.pot),
    safeTextKey(trade.symbol),
    safeTextKey(trade.side),
    safeTextKey(setup),
    safeTextKey(btc),
    safeTextKey(conf),
    safeTextKey(expected)
  ].join("|");
}

function ensureSetupLearning() {
  if (!state.setupLearning) {
    state.setupLearning = {
      updatedAt: null,
      setups: {},
      recent: []
    };
  }

  if (!state.setupLearning.setups) state.setupLearning.setups = {};
  if (!state.setupLearning.recent) state.setupLearning.recent = [];
}

function recordSetupLearning(trade) {
  ensureSetupLearning();

  const pnl = Number(trade.pnl?.netGbp || 0);
  const key = setupFingerprintForTrade(trade);

  if (!state.setupLearning.setups[key]) {
    state.setupLearning.setups[key] = {
      key,
      pot: trade.pot,
      symbol: trade.symbol,
      side: trade.side,
      setupType: inferSetupType(trade),
      btcRegime: inferBtcRegimeFromTrade(trade),
      confidenceBucket: confidenceBucket(trade.confidence || 0),
      expectedBucket: expectedBucket(trade.expectedNetGbp || trade.targetNetGbp || 0),
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnlGbp: 0,
      avgPnlGbp: 0,
      winRatePercent: 0,
      avgWinGbp: 0,
      avgLossGbp: 0,
      bestPnlGbp: null,
      worstPnlGbp: null,
      lastResult: null,
      advice: "LEARNING"
    };
  }

  const row = state.setupLearning.setups[key];

  row.trades += 1;
  row.totalPnlGbp = round2(row.totalPnlGbp + pnl);
  row.lastResult = pnlBucket(pnl);
  row.bestPnlGbp = row.bestPnlGbp === null ? pnl : Math.max(row.bestPnlGbp, pnl);
  row.worstPnlGbp = row.worstPnlGbp === null ? pnl : Math.min(row.worstPnlGbp, pnl);

  if (pnl > 0) {
    row.wins += 1;
  } else {
    row.losses += 1;
  }

  row.winRatePercent = round2((row.wins / Math.max(1, row.trades)) * 100);
  row.avgPnlGbp = round2(row.totalPnlGbp / Math.max(1, row.trades));

  const winTotal = state.setupLearning.recent
    .filter(x => x.key === key && x.pnlGbp > 0)
    .reduce((s,x) => s + x.pnlGbp, 0);

  const lossTotal = state.setupLearning.recent
    .filter(x => x.key === key && x.pnlGbp <= 0)
    .reduce((s,x) => s + x.pnlGbp, 0);

  row.avgWinGbp = row.wins ? round2(winTotal / row.wins) : 0;
  row.avgLossGbp = row.losses ? round2(lossTotal / row.losses) : 0;

  if (row.trades >= 5 && row.totalPnlGbp > 20 && row.winRatePercent >= 50) {
    row.advice = "FAVOUR_SETUP";
  } else if (row.trades >= 5 && row.totalPnlGbp < -20 && row.winRatePercent < 40) {
    row.advice = "AVOID_SETUP_CONDITION";
  } else if (row.trades >= 3 && row.totalPnlGbp < -10) {
    row.advice = "CAUTION";
  } else {
    row.advice = "LEARNING";
  }

  state.setupLearning.recent.unshift({
    time: new Date().toISOString(),
    key,
    pot: trade.pot,
    symbol: trade.symbol,
    side: trade.side,
    setupType: row.setupType,
    btcRegime: row.btcRegime,
    confidence: trade.confidence,
    expectedNetGbp: trade.expectedNetGbp || trade.targetNetGbp || 0,
    pnlGbp: pnl,
    pnlBucket: pnlBucket(pnl),
    exitReason: trade.reasonExit
  });

  state.setupLearning.recent = state.setupLearning.recent.slice(0, 500);
  state.setupLearning.updatedAt = new Date().toISOString();

  if (typeof brainLog === "function") {
    brainLog("setup_learning", trade.symbol + " " + row.advice + " " + row.setupType, {
      key,
      pnlGbp: pnl,
      trades: row.trades,
      totalPnlGbp: row.totalPnlGbp,
      winRatePercent: row.winRatePercent
    });
  }

  return row;
}

function learningAdviceForReview(reviewData) {
  ensureSetupLearning();

  const fakeTrade = {
    pot: reviewData.pot,
    symbol: reviewData.symbol,
    side: reviewData.signal,
    strategy: reviewData.strategy,
    reasonEntry: reviewData.reason,
    confidence: reviewData.confidence,
    expectedNetGbp: reviewData.expectedNetGbp,
    btcRegime: reviewData.btcRegime
  };

  const key = setupFingerprintForTrade(fakeTrade);
  const row = state.setupLearning.setups[key];

  if (!row) {
    return {
      key,
      advice: "NO_HISTORY",
      confidenceAdjustment: 0,
      block: false,
      message: "No setup history yet."
    };
  }

  if (row.advice === "FAVOUR_SETUP") {
    return {
      key,
      advice: row.advice,
      confidenceAdjustment: 5,
      block: false,
      message: "Learning favours this setup: " + row.winRatePercent + "% win rate, " + money(row.totalPnlGbp)
    };
  }

  if (row.advice === "AVOID_SETUP_CONDITION") {
    return {
      key,
      advice: row.advice,
      confidenceAdjustment: -20,
      block: row.trades >= 8,
      message: "Learning warns against this setup: " + row.winRatePercent + "% win rate, " + money(row.totalPnlGbp)
    };
  }

  if (row.advice === "CAUTION") {
    return {
      key,
      advice: row.advice,
      confidenceAdjustment: -8,
      block: false,
      message: "Learning caution: " + row.winRatePercent + "% win rate, " + money(row.totalPnlGbp)
    };
  }

  return {
    key,
    advice: row.advice,
    confidenceAdjustment: 0,
    block: false,
    message: "Learning still collecting data."
  };
}
`;

if (!code.includes("function recordSetupLearning(trade)")) {
  code = code.replace("function closePaperTrade(tradeId, reason, panic = false) {", helper + "\nfunction closePaperTrade(tradeId, reason, panic = false) {");
}

// Record learning on close
if (!code.includes("recordSetupLearning(trade);")) {
  code = code.replace(
`    createWhatIfForClosedTrade(trade);`,
`    createWhatIfForClosedTrade(trade);
    recordSetupLearning(trade);`
  );
}

// Apply learning advice inside canOpenTrade after signal check
if (!code.includes("learningAdviceForReview(reviewData);")) {
  code = code.replace(
`  if (!["LONG", "SHORT"].includes(reviewData.signal)) {
    return { ok: false, reason: "Signal is " + reviewData.signal + ", not LONG/SHORT" };
  }`,
`  if (!["LONG", "SHORT"].includes(reviewData.signal)) {
    return { ok: false, reason: "Signal is " + reviewData.signal + ", not LONG/SHORT" };
  }

  const setupAdvice = learningAdviceForReview(reviewData);
  reviewData.learningKey = setupAdvice.key;
  reviewData.learningAdvice = setupAdvice.advice;
  reviewData.learningMessage = setupAdvice.message;

  if (setupAdvice.block) {
    return { ok: false, reason: setupAdvice.message };
  }

  if (setupAdvice.confidenceAdjustment) {
    reviewData.confidence = Math.max(0, Math.min(100, reviewData.confidence + setupAdvice.confidenceAdjustment));
  }`
  );
}

// Expose setupLearning in state if publicState exists
if (!code.includes("setupLearning: state.setupLearning")) {
  code = code.replace(
`    whatIf: state.whatIf,`,
`    whatIf: state.whatIf,
    setupLearning: state.setupLearning,`
  );
}

fs.writeFileSync(file, code);

console.log("V7 setup learning patch applied.");
console.log("Backup created:", backup);
