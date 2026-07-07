const { expectedValue } = require("./expectedValue");
const { positionSize } = require("./positionSizing");

class DecisionEngine {
  constructor({ config }) {
    this.config = config;
  }

  decide(candidate) {
    const confidence = candidate.score;
    const analysis = candidate.analysis || {};
    const ev = expectedValue({
      confidence,
      expectedWinPct: 0.8,
      expectedLossPct: 0.5,
      feeBps: this.config.trade.feeBps,
      slippageBps: this.config.trade.slippageBps
    });

    const blocked = [];
    if (!candidate.passed) blocked.push(candidate.reason || "candidate did not pass scanner");
    if (analysis.realMarketData !== true) blocked.push("real market data required");
    if (!Number.isFinite(analysis.price) || analysis.price <= 0) blocked.push("valid live price required");
    if (!Number.isFinite(confidence) || confidence < 80) blocked.push("confidence below minimum");
    if (!ev || ev.netPct <= 0) blocked.push("expected value did not clear costs");
    if (!Array.isArray(analysis.signals) || analysis.signals.length < 3) blocked.push("insufficient confirming signals");

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
      side: candidate.side,
      confidence,
      sizeGbp,
      expectedValue: ev,
      entryReason: approved ? candidate.reason : null,
      scannerReason: candidate.reason,
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
