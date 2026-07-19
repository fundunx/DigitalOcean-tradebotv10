const FUTURES_API = "https://fapi.binance.com";

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function isEligibleUsdtPerpetual(symbol) {
  return symbol.status === "TRADING"
    && symbol.contractType === "PERPETUAL"
    && symbol.quoteAsset === "USDT";
}

async function discoverTopUsdtPerpetualMarkets({
  limit = 100,
  minQuoteVolume = 0
} = {}) {
  const [exchangeInfo, tickers] = await Promise.all([
    fetchJson(`${FUTURES_API}/fapi/v1/exchangeInfo`),
    fetchJson(`${FUTURES_API}/fapi/v1/ticker/24hr`)
  ]);

  const eligible = new Set(
    exchangeInfo.symbols
      .filter(isEligibleUsdtPerpetual)
      .map((symbol) => symbol.symbol)
  );

  return tickers
    .filter((ticker) => eligible.has(ticker.symbol))
    .map((ticker) => ({
      symbol: ticker.symbol.toLowerCase(),
      quoteVolume: Number(ticker.quoteVolume)
    }))
    .filter((ticker) => Number.isFinite(ticker.quoteVolume))
    .filter((ticker) => ticker.quoteVolume >= minQuoteVolume)
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
}

module.exports = { discoverTopUsdtPerpetualMarkets };
