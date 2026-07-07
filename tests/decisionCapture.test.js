const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Engine } = require("../src/core/engine");
const { loadConfig } = require("../src/core/config");

function addMarket(engine) {
  engine.cache.update("btcusdt", {
    source: "test",
    realMarketData: true,
    price: 100,
    bid: 99.99,
    ask: 100.01,
    spread: 0.02,
    candles1m: Array.from({ length: 60 }, (_, i) => ({
      close: 100 + i * 0.1,
      volume: i > 54 ? 200 : 100
    }))
  });
}

test("review without persistence does not write journal entries", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apexquant-review-no-write-"));
  const engine = new Engine(loadConfig({ DATA_DIR: dataDir }));
  addMarket(engine);

  const reviews = engine.reviewDecisions();
  const journal = engine.recentDecisionReviews();

  assert.equal(reviews.length, 1);
  assert.equal(journal.length, 0);
  assert.equal(engine.broker.openTrades.length, 0);
});

test("capture-style persisted review writes journal entries without opening trades", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apexquant-review-write-"));
  const engine = new Engine(loadConfig({ DATA_DIR: dataDir }));
  addMarket(engine);

  const reviews = engine.reviewDecisions({
    persist: true,
    context: { source: "test.capture" }
  });
  const journal = engine.recentDecisionReviews();

  assert.equal(reviews.length, 1);
  assert.equal(journal.length, 1);
  assert.equal(journal[0].context.source, "test.capture");
  assert.equal(engine.broker.openTrades.length, 0);
});
