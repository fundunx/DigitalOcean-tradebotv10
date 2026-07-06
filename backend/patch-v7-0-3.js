const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7/server-v7-before-7-0-3-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(
  'const APP_VERSION = "7.0.2";',
  'const APP_VERSION = "7.0.3";'
);

// Default scalp profile to BALANCED so it can actually test
code = code.replace(
  'scalpProfile: "STRICT", // STRICT, BALANCED, AGGRESSIVE',
  'scalpProfile: "BALANCED", // STRICT, BALANCED, AGGRESSIVE'
);

// Replace expected net logic with something less flat
const expectedStart = code.indexOf("function estimateExpectedNetProfitGbp(symbol, sizeGbp, pot) {");
const expectedEnd = code.indexOf("\n}\n\n// ==================================================\n// SECTION 15: RISK ENGINE", expectedStart);

if (expectedStart === -1 || expectedEnd === -1) {
  console.error("Could not find estimateExpectedNetProfitGbp");
  process.exit(1);
}

const newExpected = `function estimateExpectedNetProfitGbp(symbol, sizeGbp, pot) {
  const vol = volatilityPercent(symbol, 30);
  const mom5 = Math.abs(momentumPercent(symbol, 5));
  const mom20 = Math.abs(momentumPercent(symbol, 20));

  let expectedMovePercent;

  if (pot === "scalp") {
    // V7.0.3: more realistic scalp opportunity estimate.
    // It rewards short-term movement but still subtracts fees.
    expectedMovePercent = Math.max(0.25, vol * 1.4 + mom5 * 0.9 + mom20 * 0.25);
  } else {
    expectedMovePercent = Math.max(0.6, vol * 1.5);
  }

  return round2(sizeGbp * (expectedMovePercent / 100) - estimateFeesGbp(1));
}`;

code = code.slice(0, expectedStart) + newExpected + code.slice(expectedEnd + 3);

// Replace evaluateScalp function
const scalpStart = code.indexOf("function evaluateScalp(symbol) {");
const scalpEnd = code.indexOf("\n}\n\n// ==================================================\n// SECTION 14: STRATEGY BRAIN", scalpStart);

if (scalpStart === -1 || scalpEnd === -1) {
  console.error("Could not find evaluateScalp");
  process.exit(1);
}

const newScalp = `function evaluateScalp(symbol) {
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
  if (bestScore < 28) {
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
}`;

code = code.slice(0, scalpStart) + newScalp + code.slice(scalpEnd + 3);

// Migration message and active values
code = code.replace(
  'state.settings.scalp.scalpProfile = state.settings.scalp.scalpProfile || "STRICT";',
  'state.settings.scalp.scalpProfile = "BALANCED";'
);

code = code.replace(
  'brainLog("system", "Applied V7.0.2: dynamic stop fixed and scalp profile controls active.");',
  'brainLog("system", "Applied V7.0.3: balanced scalp signal scoring active.");'
);

fs.writeFileSync(file, code);

console.log("V7.0.3 patch applied.");
console.log("Backup created:");
console.log(backup);
