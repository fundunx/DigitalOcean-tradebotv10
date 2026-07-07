class BinanceRestMarketFeed {
  constructor({ symbols, cache, intervalMs = 15000 }) {
    this.symbols = symbols;
    this.cache = cache;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.started = false;
    this.lastMessageAt = null;
    this.errors = [];
  }

  async start() {
    if (this.started) return;

    this.started = true;
    await this.refreshAll();

    this.timer = setInterval(() => {
      this.refreshAll().catch((error) => {
        this.errors.push({
          message: error.message,
          at: new Date().toISOString()
        });
        this.errors = this.errors.slice(-20);
      });
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
  }

  async refreshAll() {
    for (const symbol of this.symbols) {
      await this.refreshSymbol(symbol);
    }

    this.lastMessageAt = new Date().toISOString();
  }

  async refreshSymbol(symbol) {
    const binanceSymbol = symbol.toUpperCase();

    const [priceData, bookData, candles] = await Promise.all([
      this.fetchJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${binanceSymbol}`),
      this.fetchJson(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${binanceSymbol}`),
      this.fetchJson(`https://fapi.binance.com/fapi/v1/klines?symbol=${binanceSymbol}&interval=1m&limit=60`)
    ]);

    const price = Number(priceData.price);
    const bid = Number(bookData.bidPrice);
    const ask = Number(bookData.askPrice);

    if (!Number.isFinite(price) || !Number.isFinite(bid) || !Number.isFinite(ask)) {
      throw new Error(`Invalid Binance market data for ${binanceSymbol}`);
    }

    this.cache.update(symbol.toLowerCase(), {
      source: "binance-futures-rest",
      realMarketData: true,
      price,
      bid,
      ask,
      spread: ask - bid,
      candles1m: candles.map((row) => ({
        openTime: row[0],
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: row[6]
      }))
    });
  }

  async fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  snapshot() {
    return {
      started: this.started,
      lastMessageAt: this.lastMessageAt,
      stale: !this.lastMessageAt || Date.now() - Date.parse(this.lastMessageAt) > this.intervalMs * 3,
      errors: this.errors
    };
  }

  health(staleAfterMs) {
    return {
      started: this.started,
      lastMessageAt: this.lastMessageAt,
      stale: !this.lastMessageAt || Date.now() - Date.parse(this.lastMessageAt) > (staleAfterMs || this.intervalMs * 3),
      errors: this.errors
    };
  }
}

module.exports = { BinanceRestMarketFeed };
