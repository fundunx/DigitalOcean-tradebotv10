const { expectedValue } = require("./expectedValue");
const { positionSize } = require("./positionSizing");

class DecisionEngine {
  constructor({ config }) {
    this.config = config;
  }

  decide(candidate) {
    const confidence = candidate.score;
    const ev = expectedValue({
      confidence,
      feeBps: this.config.trade.feeBps,
      slippageBps: this.config.trade.slippageBps
    });

    const sizeGbp = positionSize({
      defaultSizeGbp: this.config.trade.defaultSizeGbp,
      minSizeGbp: this.config.trade.minSizeGbp,
      confidence,
      netPct: ev.netPct
    });

    const approved = sizeGbp > 0 && ev.netPct > 0;

    return {
      approved,
      symbol: candidate.symbol,
      side: candidate.side,
      confidence,
      sizeGbp,
      expectedValue: ev,
      entryReason: candidate.reason,
      stopLossPct: 0.5,
      targetPct: 0.8,
      riskLevel: approved ? "controlled" : "rejected",
      rejectionReason: approved ? null : "expected value did not clear costs"
    };
  }
}

module.exports = { DecisionEngine };
