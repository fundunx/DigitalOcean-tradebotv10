const { loadConfig } = require("./core/config");
const { Engine } = require("./core/engine");
const { BinanceFuturesFeed } = require("./market/binanceFeed");
const { createDashboard } = require("./dashboard/server");
const { setupShutdown } = require("./core/shutdown");
const { log } = require("./core/logger");

async function main() {
  const config = loadConfig();

  if (config.mode !== "paper" || !config.liveTradingLocked) {
    throw new Error("Unsafe config: ApexQuant V10 must remain paper-only with live trading locked");
  }

  const engine = new Engine(config);
  const feed = new BinanceFuturesFeed({ symbols: config.symbols, cache: engine.cache });

  await feed.start();
  engine.seedPaperMarket();
  // Do not auto-evaluate/open paper trades on startup. Wait for real market context.

  const server = createDashboard({ engine, feed, config });

  server.listen(config.port, () => {
    log("info", "ApexQuant V10 running", { port: config.port, mode: config.mode });
  });

  setupShutdown([
    () => feed.stop(),
    () => new Promise((resolve) => server.close(resolve))
  ]);
}

if (require.main === module) {
  main().catch((error) => {
    log("error", "fatal startup error", { error: error.message });
    process.exit(1);
  });
}

module.exports = { main };
