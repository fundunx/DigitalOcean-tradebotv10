const test = require("node:test");
const assert = require("node:assert/strict");
const { Engine } = require("../src/core/engine");
const { loadConfig } = require("../src/core/config");

function candles(start = 100) {
  return Array.from({ length: 60 }, (_, index) => ({
    open: start + index * 0.1,
    high: start + index * 0.1 + 0.2,
    low: start + index * 0.1 - 0.2,
    close: start + index * 0.1,
    volume: index > 54 ? 200 : 100
  }));
}

test("read-only decision review never opens paper trades", () => {
  const engine = new Engine(loadConfig({}));
  engine.cache.update("btcusdt", {
    source: "test",
    realMarketData: true,
    price: 106,
    bid: 105.99,
    ask: 106.01,
    spread: 0.02,
    candles1m: candles()
  });

  const beforeOpenTrades = engine.broker.openTrades.length;
  const reviews = engine.reviewDecisions();

  assert.equal(beforeOpenTrades, 0);
  assert.equal(engine.broker.openTrades.length, 0);
  assert.equal(Array.isArray(reviews), true);
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].symbol, "btcusdt");
  assert.ok(reviews[0].scanner);
  assert.ok(reviews[0].decision);
  assert.ok(reviews[0].risk);
});
