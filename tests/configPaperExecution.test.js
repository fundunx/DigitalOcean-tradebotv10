const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig, numberEnv, boolEnv, listEnv } = require("../src/core/config");

test("config helpers read supplied env object", () => {
  const env = {
    TEST_NUMBER: "42",
    TEST_BOOL: "true",
    TEST_LIST: "BTCUSDT, ETHUSDT"
  };

  assert.equal(numberEnv("TEST_NUMBER", 0, env), 42);
  assert.equal(boolEnv("TEST_BOOL", false, env), true);
  assert.deepEqual(listEnv("TEST_LIST", [], env), ["btcusdt", "ethusdt"]);
});

test("paper execution config is disabled by default", () => {
  const config = loadConfig({});

  assert.equal(config.paperExecution.enabled, false);
  assert.equal(config.paperExecution.testMode, false);
  assert.equal(config.paperExecution.minConfidence, 80);
  assert.equal(config.paperExecution.minSignals, 3);
});

test("paper execution test mode lowers thresholds only when explicitly enabled", () => {
  const config = loadConfig({
    PAPER_EXECUTION_ENABLED: "true",
    PAPER_TEST_MODE: "true",
    PAPER_EXECUTION_INTERVAL_MS: "5000",
    PAPER_MAX_TRADE_AGE_MS: "60000"
  });

  assert.equal(config.paperExecution.enabled, true);
  assert.equal(config.paperExecution.testMode, true);
  assert.equal(config.paperExecution.intervalMs, 5000);
  assert.equal(config.paperExecution.maxTradeAgeMs, 60000);
  assert.equal(config.paperExecution.minConfidence, 55);
  assert.equal(config.paperExecution.minSignals, 1);
});
