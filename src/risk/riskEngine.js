class RiskEngine {
  constructor({ config }) {
    this.config = config;
  }

  check(decision, openTrades = []) {
    if (!decision.approved) return { approved: false, reason: decision.rejectionReason };
    if (decision.analysis?.realMarketData !== true) return { approved: false, reason: "real market data required" };
    if (!decision.entryReason) return { approved: false, reason: "missing entry reason" };
    const minSignals = this.config.paperExecution?.minSignals ?? 3;
    if (!Array.isArray(decision.signalsUsed) || decision.signalsUsed.length < minSignals) {
      return { approved: false, reason: "insufficient signal explanation" };
    }
    if (!decision.stopLossPct) return { approved: false, reason: "missing stop loss" };
    if (!decision.targetPct) return { approved: false, reason: "missing profit target" };
    if (!Number.isFinite(decision.sizeGbp) || decision.sizeGbp <= 0) {
      return { approved: false, reason: "invalid position size" };
    }
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
