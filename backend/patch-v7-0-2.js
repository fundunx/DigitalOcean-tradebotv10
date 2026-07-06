const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7/server-v7-before-7-0-2-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(
  'const APP_VERSION = "7.0.1";',
  'const APP_VERSION = "7.0.2";'
);

// Add scalp profile setting
code = code.replace(
`    maxOpenTrades: 1,

    dailyTargetGbp: 200,`,
`    maxOpenTrades: 1,

    scalpProfile: "STRICT", // STRICT, BALANCED, AGGRESSIVE

    dailyTargetGbp: 200,`
);

// Replace dynamic stop function
const start = code.indexOf("function dynamicScalpStopGbp(symbol) {");
const end = code.indexOf("\n}\n\nfunction evaluateScalp", start);

if (start === -1 || end === -1) {
  console.error("Could not find dynamicScalpStopGbp");
  process.exit(1);
}

const replacement = `function dynamicScalpStopGbp(symbol) {
  const vol = volatilityPercent(symbol, 30);

  const min = Number(state.settings.scalp.dynamicStopMinGbp || 5);
  const max = Number(state.settings.scalp.dynamicStopMaxGbp || 14);

  // If volatility is not ready yet, never return zero.
  if (!vol || vol <= 0) {
    return min;
  }

  const proposed = 5 + vol * 35;
  return round2(Math.max(min, Math.min(max, proposed)));
}`;

code = code.slice(0, start) + replacement + code.slice(end + 3);

// Add profile helper before canOpenTrade if missing
const helper = `
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
`;

if (!code.includes("function scalpProfileRules()")) {
  code = code.replace(
    "function canOpenTrade(pot, reviewData) {",
    helper + "\nfunction canOpenTrade(pot, reviewData) {"
  );
}

// Patch fixed values in canOpenTrade
code = code.replace(
`    const minimumExpectedNet = 8;
    if (Number(reviewData.expectedNetGbp || 0) < minimumExpectedNet) {`,
`    const profileRules = scalpProfileRules();
    const minimumExpectedNet = profileRules.minExpectedNetGbp;
    if (Number(reviewData.expectedNetGbp || 0) < minimumExpectedNet) {`
);

code = code.replace(
`    const safety = getScalpSafety();
    const dynamicConfidence = safety.consecutiveLosses >= 2 ? 90 : 85;

    if (reviewData.confidence < dynamicConfidence) {`,
`    const safety = getScalpSafety();
    const profileRules2 = scalpProfileRules();
    const dynamicConfidence = safety.consecutiveLosses >= 2 ? Math.max(90, profileRules2.minConfidence) : profileRules2.minConfidence;

    if (reviewData.confidence < dynamicConfidence) {`
);

code = code.replace(
`    const confirmations = updateScalpSignalConfirmation(reviewData);
    if (confirmations < 3) {
      return {
        ok: false,
        reason: "Waiting for 3 scalp confirmations. Current confirmation " + confirmations + "/3"
      };
    }

    return { ok: true, reason: "Scalp A+ setup passed V7.0.1 safety checks" };`,
`    const confirmations = updateScalpSignalConfirmation(reviewData);
    const requiredConfirmations = scalpProfileRules().requiredConfirmations;

    if (confirmations < requiredConfirmations) {
      return {
        ok: false,
        reason: "Waiting for " + requiredConfirmations + " scalp confirmations. Current confirmation " + confirmations + "/" + requiredConfirmations
      };
    }

    return { ok: true, reason: "Scalp " + scalpProfileRules().label + " setup passed V7.0.2 safety checks" };`
);

// Apply migration on startup
if (!code.includes("Applied V7.0.2")) {
  code = code.replace(
`brainLog("system", "Applied V7.0.1 scalp safety migration: max 1 scalp trade, stronger filters, cooldowns active.");`,
`state.settings.scalp.scalpProfile = state.settings.scalp.scalpProfile || "STRICT";
brainLog("system", "Applied V7.0.2: dynamic stop fixed and scalp profile controls active.");`
  );
}

fs.writeFileSync(file, code);

console.log("V7.0.2 patch applied.");
console.log("Backup created:");
console.log(backup);
