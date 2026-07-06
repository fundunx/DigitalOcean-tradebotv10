const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7/server-v7-before-7-0-6-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(
  'const APP_VERSION = "7.0.5";',
  'const APP_VERSION = "7.0.6";'
);

// Add scalp loss cap settings if not already present
code = code.replace(
`    dynamicStopMinGbp: 5,
    dynamicStopMaxGbp: 14,`,
`    dynamicStopMinGbp: 5,
    dynamicStopMaxGbp: 14,

    normalMaxLossGbp: 8,
    highConfidenceMaxLossGbp: 12,`
);

// Replace openPaperTrade stop loss section
code = code.replace(
`  const stopLossNetGbp = pot === "scalp"
    ? -dynamicScalpStopGbp(reviewData.symbol)
    : -(settings.tradeSizeGbp * (settings.maxLossPerTradePercent / 100));`,
`  let stopLossNetGbp;

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
  }`
);

// Add defensive exit before full stop
code = code.replace(
`      if (net <= trade.stopLossNetGbp) {`,
`      if (pot === "scalp" && net <= -6) {
        const moveAgainst =
          (trade.side === "LONG" && momentumPercent(trade.symbol, 3) < -0.005) ||
          (trade.side === "SHORT" && momentumPercent(trade.symbol, 3) > 0.005);

        if (moveAgainst) {
          trade.botThinking = "Scalp defensive exit. Loss reached £6 and momentum is against trade.";
          closePaperTrade(trade.id, "Scalp defensive exit before max loss");
          continue;
        }
      }

      if (net <= trade.stopLossNetGbp) {`
);

// Startup migration: force scalp cap values
code = code.replace(
`state.settings.scalp.maxQuickWinGbp = 12;
state.version = APP_VERSION;`,
`state.settings.scalp.maxQuickWinGbp = 12;
state.settings.scalp.normalMaxLossGbp = 8;
state.settings.scalp.highConfidenceMaxLossGbp = 12;
state.version = APP_VERSION;`
);

fs.writeFileSync(file, code);

console.log("V7.0.6 scalp loss cap patch applied.");
console.log("Backup created:");
console.log(backup);
