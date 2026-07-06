/*
==================================================
APEXQUANT V7.0.1 SAFETY PATCH
FILE: backend/patch-v7-0-1.js

PURPOSE:
- Backup server-v7.js
- Upgrade V7 test backend to 7.0.1
- Fix scalp over-trading
- Leave strategy mode mostly unchanged
==================================================
*/

const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7/server-v7-before-7-0-1-${Date.now()}.js`;

if (!fs.existsSync(file)) {
  console.error("server-v7.js not found");
  process.exit(1);
}

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

// ==================================================
// VERSION
// ==================================================

code = code.replace(
  'const APP_VERSION = "7.0.0";',
  'const APP_VERSION = "7.0.1";'
);

// ==================================================
// SAFER DEFAULT SETTINGS
// ==================================================

code = code.replace(
`  engines: {
    scalpEnabled: true,
    strategyEnabled: true,
    smartAllocationMode: false
  },`,
`  engines: {
    scalpEnabled: true,
    strategyEnabled: true,
    smartAllocationMode: false
  },`
);

code = code.replace(
`    maxOpenTrades: 5,

    dailyTargetGbp: 200,
    minimumNetProfitGbp: 3,
    idealNetProfitGbp: 6,
    maxQuickWinGbp: 10,`,
`    maxOpenTrades: 1,

    dailyTargetGbp: 200,
    minimumNetProfitGbp: 6,
    idealNetProfitGbp: 8,
    maxQuickWinGbp: 12,`
);

// ==================================================
// ADD SAFETY STATE IF NOT PRESENT
// ==================================================

code = code.replace(
`    trades: [],
    whatIf: [],
    learningApplications: []
  };`,
`    trades: [],
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
  };`
);

// ==================================================
// INSERT SCALP SAFETY HELPERS BEFORE RISK ENGINE
// ==================================================

const safetyHelpers = `
// ==================================================
// SECTION 14B: V7.0.1 SCALP SAFETY GUARD
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

  if (!safety.signalConfirmations[key]) {
    safety.signalConfirmations[key] = 0;
  }

  safety.signalConfirmations[key] += 1;
  safety.lastSignalSeenAt[key] = Date.now();

  // Clear stale or opposite confirmations.
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
    return btc === "BTC_BULLISH" || btc === "BTC_NEUTRAL";
  }

  if (reviewData.signal === "SHORT") {
    return btc === "BTC_RISK_OFF" || btc === "BTC_WEAK" || btc === "BTC_CHOP";
  }

  return false;
}

function scalpVolumeOk(symbol) {
  const volume = Number(state.prices[symbol]?.volume || 0);
  return volume >= 5000000;
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

function applyV701SafetyMigration() {
  if (!state.settings.engines) {
    state.settings.engines = {
      scalpEnabled: true,
      strategyEnabled: true,
      smartAllocationMode: false
    };
  }

  state.settings.scalp.maxOpenTrades = 1;
  state.settings.scalp.minimumNetProfitGbp = 6;
  state.settings.scalp.idealNetProfitGbp = 8;
  state.settings.scalp.maxQuickWinGbp = 12;

  getScalpSafety();

  state.version = APP_VERSION;

  brainLog("system", "Applied V7.0.1 scalp safety migration: max 1 scalp trade, stronger filters, cooldowns active.");
  saveState();
}
`;

if (!code.includes("SECTION 14B: V7.0.1 SCALP SAFETY GUARD")) {
  code = code.replace(
    "// ==================================================\n// SECTION 15: RISK ENGINE\n// ==================================================",
    safetyHelpers + "\n// ==================================================\n// SECTION 15: RISK ENGINE\n// =================================================="
  );
}

// ==================================================
// REPLACE CAN OPEN TRADE
// ==================================================

const canOpenStart = code.indexOf("function canOpenTrade(pot, reviewData) {");
const canOpenEnd = code.indexOf("// ==================================================\n// SECTION 16: TRADE ENGINE", canOpenStart);

if (canOpenStart === -1 || canOpenEnd === -1) {
  console.error("Could not find canOpenTrade section");
  process.exit(1);
}

const newCanOpen = `function canOpenTrade(pot, reviewData) {
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

    const minimumExpectedNet = 8;
    if (Number(reviewData.expectedNetGbp || 0) < minimumExpectedNet) {
      return {
        ok: false,
        reason: "Scalp blocked: expected net " + money(reviewData.expectedNetGbp || 0) + " below " + money(minimumExpectedNet)
      };
    }

    const safety = getScalpSafety();
    const dynamicConfidence = safety.consecutiveLosses >= 2 ? 90 : 85;

    if (reviewData.confidence < dynamicConfidence) {
      return {
        ok: false,
        reason: "Scalp confidence " + reviewData.confidence + "% below " + dynamicConfidence + "%"
      };
    }

    const confirmations = updateScalpSignalConfirmation(reviewData);
    if (confirmations < 3) {
      return {
        ok: false,
        reason: "Waiting for 3 scalp confirmations. Current confirmation " + confirmations + "/3"
      };
    }

    return { ok: true, reason: "Scalp A+ setup passed V7.0.1 safety checks" };
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

`;

code = code.slice(0, canOpenStart) + newCanOpen + code.slice(canOpenEnd);

// ==================================================
// REGISTER SCALP CLOSES
// ==================================================

if (!code.includes("registerScalpClose(trade, pnl.netGbp);")) {
  code = code.replace(
`    brainLog("trade_close", \`\${pot.toUpperCase()} closed \${trade.symbol}: \${reason}\`, {
      tradeId,
      netPnlGbp: pnl.netGbp,
      panicSell: panic
    });

    return trade;`,
`    brainLog("trade_close", \`\${pot.toUpperCase()} closed \${trade.symbol}: \${reason}\`, {
      tradeId,
      netPnlGbp: pnl.netGbp,
      panicSell: panic
    });

    if (pot === "scalp") {
      registerScalpClose(trade, pnl.netGbp);
    }

    return trade;`
  );
}

// ==================================================
// APPLY MIGRATION ON STARTUP
// ==================================================

if (!code.includes("applyV701SafetyMigration();")) {
  code = code.replace(
`loadState();
startBinanceFeed();`,
`loadState();
applyV701SafetyMigration();
startBinanceFeed();`
  );
}

fs.writeFileSync(file, code);

console.log("V7.0.1 patch applied.");
console.log("Backup created:");
console.log(backup);
