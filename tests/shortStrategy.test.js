const test = require("node:test");
const assert = require("node:assert/strict");
const { Scanner } = require("../src/strategy/scanner");
const { DecisionEngine } = require("../src/strategy/decisionEngine");

function bearishMarket() {
  const candles1m = Array.from({ length: 60 }, (_, index) => ({
    close: 100 - (index * 0.1),
    volume: index >= 55 ? 200 : 100
  }));

  const price = candles1m.at(-1).close;

  return {
    symbol: "bearusdt",
    price,
    bid: price - 0.005,
    ask: price + 0.005,
    spread: 0.01,
    realMarketData: true,
    candles1m
  };
}

const config = {
  trade: {
    feeBps: 5,
    slippageBps: 4,
    defaultSizeGbp: 2000,
    minSizeGbp: 250
  },
  paperExecution: {
    minConfidence: 80,
    minSignals: 3,
    shortsEnabled: true
  }
};

test("scanner produces a qualified short only for a bearish market regime", () => {
  const scanner = new Scanner({
    cache: { snapshot: () => [bearishMarket()] },
    config
  });

  const [candidate] = scanner.scan();

  assert.equal(candidate.side, "short");
  assert.equal(candidate.analysis.regime, "bearish");
  assert.equal(candidate.passed, true);
  assert.ok(candidate.analysis.signals.length >= 3);
});

test("decision engine rejects a short that conflicts with a bullish regime", () => {
  const engine = new DecisionEngine({ config });

  const decision = engine.decide({
    symbol: "conflictusdt",
    side: "short",
    score: 90,
    passed: true,
    reason: "intentionally conflicting test candidate",
    analysis: {
      realMarketData: true,
      price: 100,
      regime: "bullish",
      signals: [
        "15m trend positive",
        "30m trend positive",
        "5m momentum positive"
      ],
      blockers: []
    }
  });

  assert.equal(decision.approved, false);
  assert.equal(decision.sizeGbp, 0);
  assert.match(decision.rejectionReason, /conflicts with bullish regime/);
});

function bullishMarket() {
  const candles1m = Array.from({ length: 60 }, (_, index) => ({
    close: 100 + (index * 0.1),
    volume: index >= 55 ? 200 : 100
  }));

  const price = candles1m.at(-1).close;

  return {
    symbol: "bullusdt",
    price,
    bid: price - 0.005,
    ask: price + 0.005,
    spread: 0.01,
    realMarketData: true,
    candles1m
  };
}

function neutralMarket() {
  const candles1m = Array.from({ length: 60 }, () => ({
    close: 100,
    volume: 100
  }));

  return {
    symbol: "neutralusdt",
    price: 100,
    bid: 99.995,
    ask: 100.005,
    spread: 0.01,
    realMarketData: true,
    candles1m
  };
}

test("scanner preserves qualified long candidates for bullish regimes", () => {
  const scanner = new Scanner({
    cache: { snapshot: () => [bullishMarket()] },
    config
  });

  const [candidate] = scanner.scan();

  assert.equal(candidate.side, "long");
  assert.equal(candidate.analysis.regime, "bullish");
  assert.equal(candidate.passed, true);
});

test("scanner rejects neutral markets and keeps cash as the position", () => {
  const scanner = new Scanner({
    cache: { snapshot: () => [neutralMarket()] },
    config
  });

  const [candidate] = scanner.scan();

  assert.equal(candidate.side, null);
  assert.equal(candidate.analysis.regime, "neutral");
  assert.equal(candidate.passed, false);
  assert.match(candidate.reason, /no aligned bullish or bearish market regime/);
});


test("scanner keeps bearish setups out of execution while paper shorts are disabled", () => {
  const scanner = new Scanner({
    cache: { snapshot: () => [bearishMarket()] },
    config: {
      ...config,
      paperExecution: {
        ...config.paperExecution,
        shortsEnabled: false
      }
    }
  });

  const [candidate] = scanner.scan();

  assert.equal(candidate.analysis.regime, "bearish");
  assert.equal(candidate.side, null);
  assert.equal(candidate.passed, false);
  assert.match(candidate.reason, /paper shorts are disabled/);
});
