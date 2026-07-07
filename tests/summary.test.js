const test = require("node:test");
const assert = require("node:assert/strict");
const { Engine } = require("../src/core/engine");
const { loadConfig } = require("../src/core/config");

test("summary omits bulky candle payloads and keeps safety fields", () => {
  const engine = new Engine(loadConfig({}));
  engine.cache.update("btcusdt", {
    source: "test",
    realMarketData: true,
    price: 100,
    bid: 99.99,
    ask: 100.01,
    spread: 0.02,
    candles1m: Array.from({ length: 60 }, (_, i) => ({ close: 100 + i }))
  });

  const summary = engine.summary({ started: true, stale: false, errors: [] });

  assert.equal(summary.paperOnly, true);
  assert.equal(summary.liveTradingLocked, true);
  assert.equal(summary.marketCount, 1);
  assert.equal(summary.markets[0].candles1m, 60);
  assert.equal(summary.markets[0].candles1m instanceof Array, false);
  assert.equal(summary.openTrades, 0);
  assert.equal(summary.portfolio.cashGbp, 20000);
});
