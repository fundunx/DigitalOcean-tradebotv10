const test = require("node:test");
const assert = require("node:assert/strict");
const {
  selectScalpWinnerBasketExit,
  selectScalpSingleWinnerExits
} = require("../src/execution/scalpWinnerBasketExit");

const trades = [
  {
    id: "scalp-winner-one",
    symbol: "alphausdt",
    side: "long",
    sizeGbp: 1000,
    entryPrice: 100,
    fee: 0.4,
    tradeMode: "scalp"
  },
  {
    id: "scalp-winner-two",
    symbol: "betausdt",
    side: "long",
    sizeGbp: 1000,
    entryPrice: 100,
    fee: 0.4,
    tradeMode: "scalp"
  },
  {
    id: "scalp-loser",
    symbol: "gammausdt",
    side: "long",
    sizeGbp: 1000,
    entryPrice: 100,
    fee: 0.4,
    tradeMode: "scalp"
  },
  {
    id: "strategy-winner",
    symbol: "deltausdt",
    side: "long",
    sizeGbp: 1000,
    entryPrice: 100,
    fee: 0.4,
    tradeMode: "strategy"
  }
];

const prices = {
  alphausdt: 102,
  betausdt: 101,
  gammausdt: 99,
  deltausdt: 110
};

test("scalp winner basket exits only profitable scalp trades after fees", () => {
  const result = selectScalpWinnerBasketExit({
    trades,
    targetGbp: 25,
    priceForSymbol: (symbol) => prices[symbol]
  });

  assert.equal(result.targetReached, true);
  assert.equal(Number(result.projectedNetPnlGbp.toFixed(2)), 28.4);
  assert.deepEqual(
    result.winners.map((winner) => winner.trade.id),
    ["scalp-winner-one", "scalp-winner-two"]
  );
});

test("scalp winner basket does not exit below its net target", () => {
  const result = selectScalpWinnerBasketExit({
    trades,
    targetGbp: 29,
    priceForSymbol: (symbol) => prices[symbol]
  });

  assert.equal(result.targetReached, false);
  assert.equal(result.winners.length, 2);
});

test("scalp individual winner exits at its net £10 target", () => {
  const result = selectScalpSingleWinnerExits({
    trades,
    targetGbp: 10,
    priceForSymbol: (symbol) => prices[symbol]
  });

  assert.deepEqual(
    result.winners.map((winner) => winner.trade.id),
    ["scalp-winner-one"]
  );
});
