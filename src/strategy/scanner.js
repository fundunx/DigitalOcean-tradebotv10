class Scanner {
  constructor({ cache }) {
    this.cache = cache;
  }

  scan() {
    return this.cache.snapshot()
      .filter((market) => Number.isFinite(market.price))
      .map((market) => ({
        symbol: market.symbol,
        side: "long",
        score: market.price > 0 ? 72 : 0,
        reason: "positive paper-test market snapshot"
      }))
      .sort((a, b) => b.score - a.score);
  }
}

module.exports = { Scanner };
