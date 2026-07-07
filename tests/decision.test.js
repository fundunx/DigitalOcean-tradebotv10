const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/core/config");
const { DecisionEngine } = require("../src/strategy/decisionEngine");

test("decision includes explainability and EV", () => {
  const engine = new DecisionEngine({ config: loadConfig({}) });
  const decision = engine.decide({ symbol: "btcusdt", side: "long", score: 80, reason: "test reason" });
  assert.equal(decision.approved, true);
  assert.equal(decision.entryReason, "test reason");
  assert.ok(decision.expectedValue.netPct > 0);
});
