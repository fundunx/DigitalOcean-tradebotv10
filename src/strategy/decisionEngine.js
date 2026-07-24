const { expectedValue } = require("./expectedValue");
const { positionSize } = require("./positionSizing");

class DecisionEngine {
  constructor({ config }) {
    this.config = config;
  }

  decide(candidate) {
    const confidence = candidate.score;
    const analysis = candidate.analysis || {};
    const side = candidate.side;
    const ev = expectedValue({
      confidence,
      expectedWinPct: 0.8,
      expectedLossPct: 0.5,
      feeBps: this.config.trade.feeBps,
      slippageBps: this.config.trade.slippageBps
    });

    const blocked = [];

    if (!["long", "short"].includes(side)) {
      blocked.push("candidate side must be long or short");
    }

    if (!candidate.passed) blocked.push(candidate.reason || "candidate did not pass scanner");
    if (analysis.realMarketData !== true) blocked.push("real market data required");
    if (!Number.isFinite(analysis.price) || analysis.price <= 0) blocked.push("valid live price required");

    const expectedRegime = side === "long" ? "bullish" : side === "short" ? "bearish" : null;
    if (expectedRegime && analysis.regime && analysis.regime !== expectedRegime) {
      blocked.push(`${side} candidate conflicts with ${analysis.regime} regime`);
    }

    const minConfidence = this.config.paperExecution?.minConfidence ?? 80;
    const minSignals = this.config.paperExecution?.minSignals ?? 3;

    if (!Number.isFinite(confidence) || confidence < minConfidence) blocked.push("confidence below minimum");
    if (!ev || ev.netPct <= 0) blocked.push("expected value did not clear costs");
    if (!Array.isArray(analysis.signals) || analysis.signals.length < minSignals) {
      blocked.push("insufficient confirming signals");
    }

    const sizeGbp = blocked.length
      ? 0
      : positionSize({
        defaultSizeGbp: this.config.trade.defaultSizeGbp,
        minSizeGbp: this.config.trade.minSizeGbp,
        confidence,
        netPct: ev.netPct
      });

    const approved = blocked.length === 0 && sizeGbp > 0;

    return {
      approved,
      symbol: candidate.symbol,
      side,
      confidence,
      sizeGbp,
      expectedValue: ev,
      entryReason: approved ? candidate.reason : null,
      scanReason: candidate.reason,
      signalsUsed: analysis.signals || [],
      analysis,
      stopLossPct: approved ? 0.5 : null,
      targetPct: approved ? 0.8 : null,
      riskLevel: approved ? "controlled" : "rejected",
      rejectionReason: approved ? null : blocked.join("; "),
      alternatives: approved
        ? ["Hold cash if momentum fades", "Reject if spread widens", "Reject if volume confirmation disappears"]
        : ["Cash remains the safest position until setup quality improves"]
    };
  }
}

module.exports = { DecisionEngine };
