const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7-strategy-protect-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(
  'const APP_VERSION = "7.0.6";',
  'const APP_VERSION = "7.0.7-strategy-protect";'
);

// Add strategy book helper before evaluateOpenTrades
const helper = `
function strategyBookBias() {
  const trades = state.portfolios.strategy.openTrades || [];
  const longs = trades.filter(t => t.side === "LONG").length;
  const shorts = trades.filter(t => t.side === "SHORT").length;

  if (longs >= 3 && shorts === 1) return "LONG";
  if (shorts >= 3 && longs === 1) return "SHORT";
  if (longs > shorts) return "LONG";
  if (shorts > longs) return "SHORT";
  return "MIXED";
}
`;

if (!code.includes("function strategyBookBias()")) {
  code = code.replace("function evaluateOpenTrades() {", helper + "\nfunction evaluateOpenTrades() {");
}

// Add protection inside open trade loop
code = code.replace(
`      if (net <= trade.stopLossNetGbp) {`,
`      if (pot === "strategy") {
        const bias = strategyBookBias();

        if (bias !== "MIXED" && trade.side !== bias && net <= -15) {
          trade.botThinking = "Strategy protection exit: trade is against book bias and losing.";
          closePaperTrade(trade.id, "Strategy book-bias protection exit");
          continue;
        }

        if (net <= -25) {
          trade.botThinking = "Strategy protection exit: max strategy loss reached.";
          closePaperTrade(trade.id, "Strategy early max-loss protection");
          continue;
        }

        if (net >= 20 && !trade.trailingStopPrice) {
          const lockPrice = priceForNetPnl(trade, 10);

          trade.trailingStopPrice = lockPrice;
          trade.lockedProfitGbp = 10;
          trade.botThinking = "Strategy profit protection active: +£20 reached, locking about +£10.";
        }

        if (net >= 25 && (trade.lockedProfitGbp || 0) < 15) {
          const lockPrice = priceForNetPnl(trade, 15);

          if (trade.side === "LONG") {
            trade.trailingStopPrice = Math.max(trade.trailingStopPrice || 0, lockPrice);
          } else {
            trade.trailingStopPrice = trade.trailingStopPrice
              ? Math.min(trade.trailingStopPrice, lockPrice)
              : lockPrice;
          }

          trade.lockedProfitGbp = 15;
          trade.botThinking = "Strategy profit protection upgraded: +£25 reached, locking about +£15.";
        }
      }

      if (net <= trade.stopLossNetGbp) {`
);

fs.writeFileSync(file, code);

console.log("V7 strategy protect patch applied.");
console.log("Backup created:", backup);
