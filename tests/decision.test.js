const test = require("node:test");
const assert = require("node:assert/strict");
const { DecisionEngine } = require("../src/strategy/decisionEngine");

const config = {
  trade: {
    feeBps: 4,
    slippageBps: 4,
    defaultSizeGbp: 250,
    minSizeGbp: 25
  }
};

test("decision rejects candidates without real market evidence", () => {
  const engine = new DecisionEngine({ config });

  const decision = engine.decide({
    symbol: "btcusdt",
    side: "long",
    score: 90,
    reason: "legacy fake candidate"
  });

  assert.equal(decision.approved, false);
  assert.equal(decision.sizeGbp, 0);
  assert.match(decision.rejectionReason, /real market data required/);
  assert.ok(decision.expectedValue);
  assert.ok(Array.isArray(decision.alternatives));
});

test("decision includes explainability and EV for qualified real-data candidates", () => {
  const engine = new DecisionEngine({ config });

  const decision = engine.decide({
    symbol: "btcusdt",
    side: "long",
    score: 88,
    passed: true,
    reason: "qualified setup: 15m trend positive, 5m momentum positive, recent volume above baseline",
    analysis: {
      realMarketData: true,
      price: 63800,
      signals: [
        "15m trend positive",
        "5m momentum positive",
        "recent volume above baseline"
      ],
      blockers: [],
      spreadPct: 0.01,
      candleCount: 60
    }
  });

  assert.equal(decision.approved, true);
  assert.equal(decision.symbol, "btcusdt");
  assert.ok(decision.entryReason);
  assert.ok(decision.expectedValue);
  assert.ok(decision.expectedValue.netPct > 0);
  assert.ok(decision.sizeGbp > 0);
  assert.equal(decision.confidence, 88);
  assert.equal(decision.riskLevel, "controlled");
  assert.equal(decision.signalsUsed.length, 3);
  assert.ok(Array.isArray(decision.alternatives));
});
