const { execFileSync } = require("child_process");

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function fetchPrice(symbol) {
  const raw = execFileSync("curl", [
    "-s",
    "--max-time",
    "10",
    `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`
  ], { encoding: "utf8" });

  if (!raw.trim()) {
    throw new Error(`No Binance response for ${symbol}`);
  }

  const data = JSON.parse(raw);
  const price = Number(data.price);

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Invalid Binance price for ${symbol}: ${raw}`);
  }

  return {
    symbol,
    price,
    time: data.time || Date.now()
  };
}

function main() {
  const prices = SYMBOLS.map(fetchPrice);

  const decisions = prices.map((market) => ({
    symbol: market.symbol,
    action: "REJECT",
    approved: false,
    reason: "Live ticker price only is not enough to open a trade.",
    requiredBeforeTrading: [
      "executable bid/ask order book",
      "1m candle history",
      "5m candle history",
      "BTC market regime",
      "liquidity check",
      "spread check",
      "expected value check",
      "risk check"
    ]
  }));

  console.log(JSON.stringify({
    ok: true,
    realMarketData: true,
    paperMoneyOnly: true,
    liveTrading: false,
    source: "Binance Futures REST ticker",
    timestamp: new Date().toISOString(),
    prices,
    reviewedMarkets: decisions.length,
    openPaperTrades: 0,
    closedPaperTrades: 0,
    portfolio: {
      cashGbp: 20000,
      openTrades: 0,
      closedTrades: 0,
      feesPaidGbp: 0,
      realizedPnlGbp: 0,
      winRate: 0
    },
    decisions
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    realMarketData: false,
    paperMoneyOnly: true,
    liveTrading: false,
    error: error.message
  }, null, 2));
  process.exit(1);
}
