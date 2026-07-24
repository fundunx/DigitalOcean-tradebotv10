const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Engine } = require("../src/core/engine");
const { loadConfig } = require("../src/core/config");

function risingCandles() {
  return Array.from({ length: 60 }, (_, index) => ({
    close: 100 + index * 0.1,
    volume: index > 54 ? 200 : 100
  }));
}

function createPaperEngine(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apexquant-paper-loop-"));
  const config = loadConfig({
    DATA_DIR: dataDir,
    PAPER_EXECUTION_ENABLED: "true",
    PAPER_TEST_MODE: "true",
    PAPER_MIN_CONFIDENCE: "55",
    PAPER_MIN_SIGNALS: "1",
    PAPER_MAX_TRADE_AGE_MS: "1",
    PAPER_FIXED_TRADE_SIZE_GBP: "250",
    TRADE_SIZE_GBP: "250",
    MIN_TRADE_SIZE_GBP: "25",
    PAPER_SCALP_POT_GBP: "1000",
    PAPER_STRATEGY_POT_GBP: "1000",
    PAPER_TOTAL_POT_GBP: "2000",
    PAPER_MAX_SCALP_TRADES: "4",
    PAPER_MAX_STRATEGY_TRADES: "4",
    ...overrides
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

  return { engine, dataDir };
}

test("a qualified setup opens one deliberate strategy/scalp paper comparison pair", () => {
  const { engine } = createPaperEngine();

  const result = engine.runPaperExecutionCycle({ source: "test.open-pair" });

  assert.equal(result.enabled, true);
  assert.equal(result.opened.length, 2);
  assert.deepEqual(
    result.opened.map((trade) => trade.tradeMode).sort(),
    ["scalp", "strategy"]
  );
  assert.equal(
    new Set(result.opened.map((trade) => trade.symbol)).size,
    1
  );
  assert.equal(engine.paperOpenTradesForMode("strategy").length, 1);
  assert.equal(engine.paperOpenTradesForMode("scalp").length, 1);
  assert.equal(engine.broker.openTrades.length, 2);
});

test("paper comparison admission is all-or-nothing when one pot lacks capacity", () => {
  const { engine } = createPaperEngine({
    PAPER_SCALP_POT_GBP: "100"
  });

  const result = engine.runPaperExecutionCycle({ source: "test.pair-capacity" });

  assert.equal(result.opened.length, 0);
  assert.equal(engine.broker.openTrades.length, 0);

  const rejection = engine.events.recent().find(
    (event) => event.type === "paper.trade.rejected"
  );
  assert.ok(rejection);
  assert.match(rejection.payload.reason, /scalp paper pot has/);
});

test("paper execution cycle stays disabled by default", () => {
  const engine = new Engine(loadConfig({}));
  const result = engine.runPaperExecutionCycle({ source: "test.disabled" });

  assert.equal(result.enabled, false);
  assert.equal(result.opened.length, 0);
  assert.equal(engine.broker.openTrades.length, 0);
});

test("a comparison pair closes together on the maximum trade-age exit", () => {
  const { engine } = createPaperEngine();

  const first = engine.runPaperExecutionCycle({ source: "test.open-pair" });
  assert.equal(first.opened.length, 2);

  for (const trade of engine.broker.openTrades) {
    trade.openedAt = new Date(Date.now() - 5000).toISOString();
  }

  const second = engine.runPaperExecutionCycle({ source: "test.close-pair" });

  assert.equal(second.closed.length, 2);
  assert.equal(engine.broker.openTrades.length, 0);
  assert.equal(engine.broker.closedTrades.length, 2);
});
