const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Engine } = require("../src/core/engine");
const { loadConfig } = require("../src/core/config");

function risingCandles() {
  return Array.from({ length: 60 }, (_, i) => ({
    close: 100 + i * 0.1,
    volume: i > 54 ? 200 : 100
  }));
}

test("paper execution cycle can open and close paper trades only when enabled", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apexquant-paper-loop-"));
  const config = loadConfig({
    DATA_DIR: dataDir,
    PAPER_EXECUTION_ENABLED: "true",
    PAPER_TEST_MODE: "true",
    PAPER_MIN_CONFIDENCE: "55",
    PAPER_MIN_SIGNALS: "1",
    PAPER_MAX_TRADE_AGE_MS: "1",
    TRADE_SIZE_GBP: "250",
    MIN_TRADE_SIZE_GBP: "25"
  });

  const engine = new Engine(config);
  engine.cache.update("btcusdt", {
    source: "test",
    realMarketData: true,
    price: 106,
    bid: 105.99,
    ask: 106.01,
    spread: 0.02,
    candles1m: risingCandles()
  });

  const first = engine.runPaperExecutionCycle({ source: "test.open" });
  assert.equal(first.enabled, true);
  assert.equal(first.opened.length, 1);
  assert.deepEqual(
    first.opened.map((trade) => trade.tradeMode),
    ["strategy"]
  );
  assert.equal(engine.broker.openTrades.length, 1);

  for (const trade of engine.broker.openTrades) {
    trade.openedAt = new Date(Date.now() - 5000).toISOString();
  }

  const second = engine.runPaperExecutionCycle({ source: "test.close" });
  assert.equal(second.closed.length, 1);
  assert.equal(engine.broker.openTrades.length, 0);
  assert.equal(engine.broker.closedTrades.length, 1);
});

test("paper execution cycle stays disabled by default", () => {
  const engine = new Engine(loadConfig({}));
  const result = engine.runPaperExecutionCycle({ source: "test.disabled" });

  assert.equal(result.enabled, false);
  assert.equal(result.opened.length, 0);
  assert.equal(engine.broker.openTrades.length, 0);
});
