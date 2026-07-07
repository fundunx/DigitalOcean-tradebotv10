const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/core/config");

test("config defaults are paper only and live locked", () => {
  const config = loadConfig({});
  assert.equal(config.mode, "paper");
  assert.equal(config.liveTradingLocked, true);
});
