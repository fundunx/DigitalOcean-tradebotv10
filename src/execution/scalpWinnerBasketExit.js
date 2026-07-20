const DEFAULT_FEE_RATE = 0.0004;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function projectedNetPnlAfterFees(trade, exitPrice, feeRate = DEFAULT_FEE_RATE) {
  const sizeGbp = Number(trade.sizeGbp);
  const entryPrice = Number(trade.entryPrice);
  const price = Number(exitPrice);

  if (!finitePositive(sizeGbp) || !finitePositive(entryPrice) || !finitePositive(price)) {
    return null;
  }

  const direction = trade.side === "short" ? -1 : 1;
  const grossPnlGbp = sizeGbp * ((price - entryPrice) / entryPrice) * direction;
  const entryFeeGbp = Number.isFinite(Number(trade.fee))
    ? Number(trade.fee)
    : sizeGbp * feeRate;
  const estimatedExitFeeGbp = sizeGbp * feeRate;

  return {
    grossPnlGbp,
    entryFeeGbp,
    estimatedExitFeeGbp,
    netPnlGbp: grossPnlGbp - entryFeeGbp - estimatedExitFeeGbp
  };
}

function selectScalpWinnerBasketExit({
  trades = [],
  priceForSymbol,
  targetGbp = 25,
  feeRate = DEFAULT_FEE_RATE
} = {}) {
  if (typeof priceForSymbol !== "function" || !finitePositive(Number(targetGbp))) {
    return {
      targetReached: false,
      targetGbp: Number(targetGbp) || 0,
      projectedNetPnlGbp: 0,
      winners: []
    };
  }

  const winners = [];

  for (const trade of trades) {
    const mode = trade.tradeMode || trade.potName || "scalp";
    if (mode !== "scalp") continue;

    const projection = projectedNetPnlAfterFees(
      trade,
      priceForSymbol(trade.symbol),
      feeRate
    );

    if (projection && projection.netPnlGbp > 0) {
      winners.push({ trade, ...projection });
    }
  }

  const projectedNetPnlGbp = winners.reduce(
    (sum, winner) => sum + winner.netPnlGbp,
    0
  );

  return {
    targetReached: projectedNetPnlGbp >= Number(targetGbp),
    targetGbp: Number(targetGbp),
    projectedNetPnlGbp,
    winners
  };
}

module.exports = {
  DEFAULT_FEE_RATE,
  projectedNetPnlAfterFees,
  selectScalpWinnerBasketExit
};
