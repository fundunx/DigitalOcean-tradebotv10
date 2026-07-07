function positionSize({ defaultSizeGbp, minSizeGbp, confidence, netPct }) {
  if (netPct <= 0) return 0;
  const multiplier = Math.max(0, Math.min(1, confidence / 100));
  const size = Math.round(defaultSizeGbp * multiplier);
  return Math.max(minSizeGbp, Math.min(defaultSizeGbp, size));
}

module.exports = { positionSize };
