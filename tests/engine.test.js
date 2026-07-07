const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/core/config");
const { Engine } = require("../src/core/engine");

test("engine opens paper trades and exposes state", () => {
  const engine = new Engine(loadConfig({}));
  engine.seedPaperMarket();
  engine.evaluate();
  const state = engine.state();
  assert.equal(state.mode, "paper");
  assert.ok(state.openTrades.length > 0);
  assert.equal(state.liveTradingLocked, true);
});
