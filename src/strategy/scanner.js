const { analyseMarket } = require("./marketAnalysis");

class Scanner {
  constructor({ cache }) {
    this.cache = cache;
  }

  scan() {
    return this.cache.snapshot()
      .map((market) => {
        const analysis = analyseMarket(market);
        const passed = analysis.blockers.length === 0 && analysis.score >= 80 && analysis.signals.length >= 3;

        return {
          symbol: market.symbol,
          side: "long",
          score: analysis.score,
          analysis,
          passed,
          reason: passed
            ? `qualified setup: ${analysis.signals.join(", ")}`
            : `rejected setup: ${analysis.blockers.concat([
                analysis.score < 80 ? `confidence below threshold (${analysis.score}/100)` : null,
                analysis.signals.length < 3 ? `not enough confirming signals (${analysis.signals.length}/3)` : null
              ].filter(Boolean)).join("; ")}`
        };
      })
      .sort((a, b) => b.score - a.score);
  }
}

module.exports = { Scanner };
