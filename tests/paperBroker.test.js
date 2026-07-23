const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { PaperBroker } = require("../src/execution/paperBroker");

function withTemporaryDataDir(run) {
  const previousDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "apexquant-broker-"));

  process.env.DATA_DIR = dataDir;

  try {
    return run();
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }

    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function decision(symbol, side) {
  return {
    symbol,
    side,
    sizeGbp: 2000,
    stopLossPct: 1,
    targetPct: 1,
    entryReason: "test decision"
  };
}

test("paper broker records all costs and true net P&L for long and short trades", () => {
  for (const [side, exitPrice] of [
    ["long", 101],
    ["short", 99]
  ]) {
    withTemporaryDataDir(() => {
      const broker = new PaperBroker({
        startingBalanceGbp: 20000,
        feeBps: 5
      });

      const opened = broker.open(decision("testusdt", side), 100);
      const closed = broker.close(opened.id, exitPrice, "test close");

      assert.equal(opened.entryFeeGbp, 1);
      assert.equal(closed.entryFeeGbp, 1);
      assert.equal(closed.exitFeeGbp, 1);
      assert.equal(closed.closeFee, 1);
      assert.equal(closed.grossPnlGbp, 20);
      assert.equal(closed.totalCostsGbp, 2);
      assert.equal(closed.pnlGbp, 18);
      assert.equal(closed.pnlIncludesEntryFee, true);
      assert.equal(broker.cashGbp, 20018);
      assert.equal(broker.feesPaidGbp, 2);
    });
  }
});

test("paper broker preserves an existing open trade's stored entry fee", () => {
  withTemporaryDataDir(() => {
    const broker = new PaperBroker({
      startingBalanceGbp: 20000,
      feeBps: 5
    });

    broker.openTrades.push({
      id: "legacy-trade",
      symbol: "legacyusdt",
      side: "long",
      sizeGbp: 2000,
      entryPrice: 100,
      openedAt: new Date().toISOString(),
      fee: 0.8,
      stopLossPct: 1,
      targetPct: 1
    });

    const closed = broker.close("legacy-trade", 101, "legacy close");

    assert.equal(closed.fee, 0.8);
    assert.equal(closed.entryFeeGbp, 0.8);
    assert.equal(closed.exitFeeGbp, 1);
    assert.equal(closed.grossPnlGbp, 20);
    assert.equal(closed.totalCostsGbp, 1.8);
    assert.equal(closed.pnlGbp, 18.2);
  });
});
