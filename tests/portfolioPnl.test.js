const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateTradePnl,
  estimateRoundTripFees
} = require("../src/portfolio/portfolioPnl");

test("estimates both fees for a £2,000 trade at 4 basis points per side", () => {
  assert.deepEqual(
    estimateRoundTripFees({ sizeGbp: 2000, feeBps: 4 }),
    {
      feeRate: 0.0004,
      entryFeeGbp: 0.8,
      exitFeeGbp: 0.8,
      totalFeesGbp: 1.6
    }
  );
});

test("calculates long net P&L after all costs", () => {
  const result = calculateTradePnl({
    side: "long",
    sizeGbp: 2000,
    entryPrice: 100,
    exitPrice: 101,
    entryFeeGbp: 0.8,
    exitFeeGbp: 0.8
  });

  assert.equal(result.grossPnlGbp, 20);
  assert.equal(result.totalCostsGbp, 1.6);
  assert.equal(result.netPnlGbp, 18.4);
});

test("calculates short net P&L after all costs", () => {
  const result = calculateTradePnl({
    side: "short",
    sizeGbp: 2000,
    entryPrice: 100,
    exitPrice: 99,
    entryFeeGbp: 0.8,
    exitFeeGbp: 0.8
  });

  assert.equal(result.grossPnlGbp, 20);
  assert.equal(result.netPnlGbp, 18.4);
});
