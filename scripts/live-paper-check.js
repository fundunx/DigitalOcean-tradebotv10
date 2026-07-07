const { execFileSync } = require("child_process");
const { loadConfig } = require("../src/core/config");
const { Engine } = require("../src/core/engine");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function fetchPrice(symbol) {
  const raw = execFileSync("curl", [
    "-s",
    "--max-time",
    "10",
    `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`
  ], { encoding: "utf8" });

  if (!raw.trim()) {
    throw new Error(`No Binance response for ${symbol}`);
  }

  const data = JSON.parse(raw);
  const price = Number(data.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid Binance price for ${symbol}: ${raw}`);
  }

  return {
    symbol,
    price,
    time: data.time || Date.now()
  };
}

function main() {
  const config = loadConfig();

  if (config.liveTradingLocked !== true || config.mode !== "paper") {
    throw new Error("Safety stop: this script only runs in locked paper mode.");
  }

  const engine = new Engine(config);
  const prices = [];

  for (const symbol of SYMBOLS) {
    const market = fetchPrice(symbol);
    prices.push(market);
    engine.cache.update(symbol.toLowerCase(), {
      price: market.price,
      source: "binance-futures-rest"
    });
  }

  const reviews = engine.evaluate();
  const state = engine.state();

  console.log(JSON.stringify({
    ok: true,
    realMarketData: true,
    paperMoneyOnly: true,
    liveTrading: false,
    source: "Binance Futures REST ticker",
    timestamp: new Date().toISOString(),
    prices,
    reviewedMarkets: reviews.length,
    openPaperTrades: state.openTrades.length,
    portfolio: state.portfolio,
    decisions: reviews.map((review) => ({
      symbol: review.symbol,
      action: review.decision.action,
      confidence: review.decision.confidence,
      expectedValue: review.decision.expectedValue,
      reason: review.decision.reason,
      riskChecks: review.risk
    }))
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    realMarketData: false,
    paperMoneyOnly: true,
    liveTrading: false,
    error: error.message
  }, null, 2));
  process.exit(1);
}
