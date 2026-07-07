function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name, fallback) {
  if (process.env[name] === undefined) return fallback;
  return ["true", "1", "yes", "on"].includes(String(process.env[name]).toLowerCase());
}

function listEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function loadConfig(env = process.env) {
  return {
    port: numberEnv("PORT", 3000),
    mode: env.MODE || "paper",
    liveTradingLocked: boolEnv("LIVE_TRADING_LOCKED", true),
    dashboardApiToken: env.DASHBOARD_API_TOKEN || "",
    symbols: listEnv("FEED_SYMBOLS", ["btcusdt", "ethusdt", "solusdt"]),
    staleAfterMs: numberEnv("FEED_STALE_AFTER_MS", 30000),
    startingBalanceGbp: numberEnv("STARTING_BALANCE_GBP", 20000),
    trade: {
      defaultSizeGbp: numberEnv("TRADE_SIZE_GBP", 2000),
      minSizeGbp: numberEnv("MIN_TRADE_SIZE_GBP", 250),
      feeBps: numberEnv("FEE_BPS", 4),
      slippageBps: numberEnv("SLIPPAGE_BPS", 4),
      maxOpenTradesPerPot: numberEnv("MAX_OPEN_TRADES_PER_POT", 5)
    },
    risk: {
      limitsEnabled: boolEnv("RISK_LIMITS_ENABLED", false),
      maxDailyLossGbp: numberEnv("MAX_DAILY_LOSS_GBP", 500),
      maxDrawdownPct: numberEnv("MAX_DRAWDOWN_PCT", 8),
      maxPortfolioExposurePct: numberEnv("MAX_PORTFOLIO_EXPOSURE_PCT", 50)
    }
  };
}

module.exports = { loadConfig, numberEnv, boolEnv, listEnv };
