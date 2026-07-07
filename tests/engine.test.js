const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/core/config");
const { Engine } = require("../src/core/engine");

test("engine starts safely without fake startup trades", () => {
  const engine = new Engine(loadConfig());
  const state = engine.state();

  assert.equal(state.mode, "paper");
  assert.equal(state.liveTradingLocked, true);
  assert.equal(state.openTrades.length, 0);
  assert.equal(state.portfolio.openTrades, 0);
});
