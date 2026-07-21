function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveNumber(value, name) {
  const parsed = number(value, NaN);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return parsed;
}

function directionForSide(side) {
  if (side === "long") return 1;
  if (side === "short") return -1;

  throw new Error('side must be "long" or "short"');
}

function feeRateFromBps(feeBps) {
  const bps = number(feeBps, NaN);

  if (!Number.isFinite(bps) || bps < 0) {
    throw new Error("feeBps must be a non-negative number");
  }

  return bps / 10000;
}

function estimateRoundTripFees({ sizeGbp, feeBps }) {
  const size = positiveNumber(sizeGbp, "sizeGbp");
  const feeRate = feeRateFromBps(feeBps);
  const entryFeeGbp = size * feeRate;
  const exitFeeGbp = size * feeRate;

  return {
    feeRate,
    entryFeeGbp,
    exitFeeGbp,
    totalFeesGbp: entryFeeGbp + exitFeeGbp
  };
}

function calculateTradePnl({
  side,
  sizeGbp,
  entryPrice,
  exitPrice,
  entryFeeGbp = 0,
  exitFeeGbp = 0,
  fundingGbp = 0,
  slippageGbp = 0
}) {
  const direction = directionForSide(side);
  const size = positiveNumber(sizeGbp, "sizeGbp");
  const entry = positiveNumber(entryPrice, "entryPrice");
  const exit = positiveNumber(exitPrice, "exitPrice");

  const grossPnlGbp = size * ((exit - entry) / entry) * direction;
  const totalCostsGbp =
    number(entryFeeGbp) +
    number(exitFeeGbp) +
    number(fundingGbp) +
    number(slippageGbp);

  return {
    grossPnlGbp,
    entryFeeGbp: number(entryFeeGbp),
    exitFeeGbp: number(exitFeeGbp),
    fundingGbp: number(fundingGbp),
    slippageGbp: number(slippageGbp),
    totalCostsGbp,
    netPnlGbp: grossPnlGbp - totalCostsGbp
  };
}

module.exports = {
  calculateTradePnl,
  directionForSide,
  estimateRoundTripFees,
  feeRateFromBps
};
