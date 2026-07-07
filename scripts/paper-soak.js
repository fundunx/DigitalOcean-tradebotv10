const { loadConfig } = require("../src/core/config");
const { Engine } = require("../src/core/engine");

const config = loadConfig();
const engine = new Engine(config);

engine.seedPaperMarket();

for (let i = 0; i < 5; i += 1) {
  engine.evaluate();
}

for (const trade of [...engine.broker.openTrades]) {
  engine.broker.close(trade.id, trade.entryPrice * 1.01, "offline paper soak target");
}

const result = engine.state();

console.log(JSON.stringify({
  ok: true,
  closedTrades: result.closedTrades.length,
  openTrades: result.openTrades.length,
  realizedPnlGbp: result.portfolio.realizedPnlGbp,
  feesPaidGbp: result.portfolio.feesPaidGbp,
  winRate: result.portfolio.winRate
}, null, 2));
