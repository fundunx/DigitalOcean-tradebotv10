function expectedValue({ confidence = 0, expectedWinPct = 0.8, expectedLossPct = 0.4, feeBps = 4, slippageBps = 4 }) {
  const winProbability = Math.max(0.05, Math.min(0.95, confidence / 100));
  const costsPct = (feeBps + slippageBps) / 100;
  const grossPct = (winProbability * expectedWinPct) - ((1 - winProbability) * expectedLossPct);
  const netPct = grossPct - costsPct;
  return { winProbability, grossPct, costsPct, netPct };
}

module.exports = { expectedValue };
