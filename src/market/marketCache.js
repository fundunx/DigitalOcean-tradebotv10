class MarketCache {
  constructor() {
    this.markets = new Map();
    this.updatedAt = null;
  }

  update(symbol, tick) {
    const previous = this.markets.get(symbol) || {};
    const next = { ...previous, ...tick, symbol, updatedAt: new Date().toISOString() };
    this.markets.set(symbol, next);
    this.updatedAt = next.updatedAt;
    return next;
  }

  snapshot() {
    return Array.from(this.markets.values());
  }
}

module.exports = { MarketCache };
