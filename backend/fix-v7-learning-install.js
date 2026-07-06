const fs = require("fs");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7-learning-install-${Date.now()}.js`;

fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(/const APP_VERSION = "[^"]+";/, 'const APP_VERSION = "7.1.0-adaptive-learning";');

const learningBlock = `
function ensureSetupLearning() {
  if (!state.setupLearning) {
    state.setupLearning = {
      updatedAt: null,
      setups: {},
      recent: []
    };
  }
}

function getSetupType(trade) {
  const text = [
    trade.strategy,
    trade.reasonEntry,
    trade.botThinking
  ].join(" ").toLowerCase();

  if (text.includes("support")) return "SUPPORT";
  if (text.includes("resistance")) return "RESISTANCE";
  if (text.includes("breakout")) return "BREAKOUT";
  if (text.includes("trend")) return "TREND";
  if (text.includes("scalp")) return "SCALP";
  return "GENERAL";
}

function getLearningKey(trade) {
  return [
    trade.pot || "unknown",
    trade.symbol || "unknown",
    trade.side || "unknown",
    getSetupType(trade),
    trade.confidence >= 85 ? "HIGH_CONF" : trade.confidence >= 70 ? "MID_CONF" : "LOW_CONF"
  ].join("|");
}

function recordAdaptiveLearning(trade) {
  ensureSetupLearning();

  const pnl = Number(trade.pnl?.netGbp || 0);
  const key = getLearningKey(trade);

  if (!state.setupLearning.setups[key]) {
    state.setupLearning.setups[key] = {
      key,
      pot: trade.pot,
      symbol: trade.symbol,
      side: trade.side,
      setupType: getSetupType(trade),
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnlGbp: 0,
      winRatePercent: 0,
      avgPnlGbp: 0,
      advice: "LEARNING"
    };
  }

  const row = state.setupLearning.setups[key];

  row.trades += 1;
  row.totalPnlGbp = Math.round((row.totalPnlGbp + pnl) * 100) / 100;

  if (pnl > 0) row.wins += 1;
  else row.losses += 1;

  row.winRatePercent = Math.round((row.wins / Math.max(1, row.trades)) * 10000) / 100;
  row.avgPnlGbp = Math.round((row.totalPnlGbp / Math.max(1, row.trades)) * 100) / 100;

  if (row.trades >= 5 && row.totalPnlGbp > 20 && row.winRatePercent >= 50) {
    row.advice = "FAVOUR";
  } else if (row.trades >= 5 && row.totalPnlGbp < -20 && row.winRatePercent < 40) {
    row.advice = "AVOID_THIS_SETUP";
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
    confidence: trade.confidence,
    pnlGbp: pnl,
    exitReason: trade.reasonExit,
    adviceAfterTrade: row.advice
  });

  state.setupLearning.recent = state.setupLearning.recent.slice(0, 500);
  state.setupLearning.updatedAt = new Date().toISOString();

  return row;
}

function learningAdviceForReview(reviewData) {
  ensureSetupLearning();

  if (!["LONG", "SHORT"].includes(reviewData.signal)) {
    return { advice: "NO_SIGNAL", block: false, confidenceAdjustment: 0, message: "" };
  }

  const fakeTrade = {
    pot: reviewData.pot,
    symbol: reviewData.symbol,
    side: reviewData.signal,
    strategy: reviewData.strategy,
    reasonEntry: reviewData.reason,
    confidence: reviewData.confidence
  };

  const key = getLearningKey(fakeTrade);
  const row = state.setupLearning.setups[key];

  if (!row) {
    return { advice: "NO_HISTORY", block: false, confidenceAdjustment: 0, message: "No history yet" };
  }

  if (row.advice === "FAVOUR") {
    return {
      advice: "FAVOUR",
      block: false,
      confidenceAdjustment: 5,
      message: "Learning favours this setup: " + row.winRatePercent + "% win rate, £" + row.totalPnlGbp
    };
  }

  if (row.advice === "AVOID_THIS_SETUP") {
    return {
      advice: "AVOID_THIS_SETUP",
      block: row.trades >= 8,
      confidenceAdjustment: -20,
      message: "Learning warns against this setup: " + row.winRatePercent + "% win rate, £" + row.totalPnlGbp
    };
  }

  if (row.advice === "CAUTION") {
    return {
      advice: "CAUTION",
      block: false,
      confidenceAdjustment: -8,
      message: "Learning caution: " + row.winRatePercent + "% win rate, £" + row.totalPnlGbp
    };
  }

  return { advice: "LEARNING", block: false, confidenceAdjustment: 0, message: "Learning still building" };
}
`;

if (!code.includes("function recordAdaptiveLearning(trade)")) {
  const marker = "function closePaperTrade";
  const pos = code.indexOf(marker);
  if (pos === -1) throw new Error("Could not find closePaperTrade");
  code = code.slice(0, pos) + learningBlock + "\\n" + code.slice(pos);
}

if (!code.includes("recordAdaptiveLearning(trade);")) {
  code = code.replace(
    "state.trades = state.trades.slice(0, 1000);",
    "state.trades = state.trades.slice(0, 1000);\\n\\n    recordAdaptiveLearning(trade);"
  );
}

if (!code.includes("const adaptiveLearning = learningAdviceForReview(reviewData);")) {
  code = code.replace(
`  if (!["LONG", "SHORT"].includes(reviewData.signal)) {
    return { ok: false, reason: "Signal is " + reviewData.signal + ", not LONG/SHORT" };
  }`,
`  if (!["LONG", "SHORT"].includes(reviewData.signal)) {
    return { ok: false, reason: "Signal is " + reviewData.signal + ", not LONG/SHORT" };
  }

  const adaptiveLearning = learningAdviceForReview(reviewData);
  reviewData.learningAdvice = adaptiveLearning.advice;
  reviewData.learningMessage = adaptiveLearning.message;

  if (adaptiveLearning.block) {
    return { ok: false, reason: adaptiveLearning.message };
  }

  if (adaptiveLearning.confidenceAdjustment) {
    reviewData.confidence = Math.max(0, Math.min(100, reviewData.confidence + adaptiveLearning.confidenceAdjustment));
  }`
  );
}

if (!code.includes("setupLearning: state.setupLearning")) {
  code = code.replace(
    "reviewedPairs: state.reviewedPairs,",
    "reviewedPairs: state.reviewedPairs,\\n    setupLearning: state.setupLearning,"
  );
}

fs.writeFileSync(file, code);

console.log("Adaptive learning installed.");
console.log("Backup:", backup);
