class RiskEngine {
  constructor({ config }) {
    this.config = config;
  }

  check(decision, openTrades = []) {
    if (!decision.approved) return { approved: false, reason: decision.rejectionReason };
    if (!decision.entryReason) return { approved: false, reason: "missing entry reason" };
    if (!decision.stopLossPct) return { approved: false, reason: "missing stop loss" };
    if (!decision.targetPct) return { approved: false, reason: "missing profit target" };
    if (openTrades.some((trade) => trade.symbol === decision.symbol)) {
      return { approved: false, reason: "duplicate symbol exposure" };
    }
    if (openTrades.length >= this.config.trade.maxOpenTradesPerPot) {
      return { approved: false, reason: "max open trades reached" };
    }
    return { approved: true, reason: "risk checks passed" };
  }
}

module.exports = { RiskEngine };
