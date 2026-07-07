const { analyseMarket } = require("./marketAnalysis");

class Scanner {
  constructor({ cache, config = {} }) {
    this.cache = cache;
    this.config = config;
  }

  scan() {
    return this.cache.snapshot()
      .map((market) => {
        const analysis = analyseMarket(market);
        const minConfidence = this.config.paperExecution?.minConfidence ?? 80;
        const minSignals = this.config.paperExecution?.minSignals ?? 3;
        const passed = analysis.blockers.length === 0 && analysis.score >= minConfidence && analysis.signals.length >= minSignals;

        return {
          symbol: market.symbol,
          side: "long",
          score: analysis.score,
          analysis,
          passed,
          reason: passed
            ? `qualified setup: ${analysis.signals.join(", ")}`
            : `rejected setup: ${analysis.blockers.concat([
                analysis.score < minConfidence ? `confidence below threshold (${analysis.score}/100, min ${minConfidence})` : null,
                analysis.signals.length < minSignals ? `not enough confirming signals (${analysis.signals.length}/${minSignals})` : null
              ].filter(Boolean)).join("; ")}`
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}

module.exports = { Scanner };
