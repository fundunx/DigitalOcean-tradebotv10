const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DecisionJournal } = require("../src/journal/decisionJournal");
const { Engine } = require("../src/core/engine");
const { loadConfig } = require("../src/core/config");

test("decision journal persists reviews as jsonl", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apexquant-decisions-"));
  const journal = new DecisionJournal({ dataDir });

  const entries = journal.appendBatch({
    context: { source: "test" },
    reviews: [{ symbol: "btcusdt", decision: { approved: false } }]
  });

  assert.equal(entries.length, 1);

  const recent = journal.recent();
  assert.equal(recent.length, 1);
  assert.equal(recent[0].type, "decision.review");
  assert.equal(recent[0].context.source, "test");
  assert.equal(recent[0].review.symbol, "btcusdt");
});

test("engine can persist read-only decision reviews without opening trades", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apexquant-engine-decisions-"));
  const config = loadConfig({ DATA_DIR: dataDir });
  const engine = new Engine(config);

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

  const reviews = engine.reviewDecisions({ persist: true, context: { source: "test" } });
  const journal = engine.recentDecisionReviews();

  assert.equal(reviews.length, 1);
  assert.equal(journal.length, 1);
  assert.equal(engine.broker.openTrades.length, 0);
});
