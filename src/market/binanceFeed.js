class BinanceFuturesFeed {
  constructor({ symbols = [], cache, now = () => Date.now() } = {}) {
    this.symbols = symbols;
    this.cache = cache;
    this.now = now;
    this.started = false;
    this.lastMessageAt = null;
    this.errors = [];
  }

  start() {
    this.started = true;
    return Promise.resolve();
  }

  stop() {
    this.started = false;
    return Promise.resolve();
  }

  ingest(symbol, price) {
    this.lastMessageAt = this.now();
    if (this.cache) this.cache.update(symbol, { price });
  }

  health(staleAfterMs = 30000) {
    const ageMs = this.lastMessageAt ? this.now() - this.lastMessageAt : null;
    return {
      started: this.started,
      lastMessageAt: this.lastMessageAt,
      stale: ageMs === null || ageMs > staleAfterMs,
      errors: this.errors.slice(-5)
    };
  }
}

module.exports = { BinanceFuturesFeed };
