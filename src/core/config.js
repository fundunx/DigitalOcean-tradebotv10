function numberEnv(name, fallback, env = process.env) {
  const value = Number(env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name, fallback, env = process.env) {
  if (env[name] === undefined) return fallback;
  return ["true", "1", "yes", "on"].includes(String(env[name]).toLowerCase());
}

function listEnv(name, fallback, env = process.env) {
  const raw = env[name];
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function loadConfig(env = process.env) {
  const paperTestMode = boolEnv("PAPER_TEST_MODE", false, env);

  return {
    port: numberEnv("PORT", 3000, env),
    mode: env.MODE || "paper",
    liveTradingLocked: boolEnv("LIVE_TRADING_LOCKED", true, env),
    dashboardApiToken: env.DASHBOARD_API_TOKEN || "",
    dataDir: env.DATA_DIR || "data",
    symbols: listEnv("FEED_SYMBOLS", [], env),
    staleAfterMs: numberEnv("FEED_STALE_AFTER_MS", 30000, env),
    startingBalanceGbp: numberEnv("STARTING_BALANCE_GBP", 20000, env),
    trade: {
      defaultSizeGbp: numberEnv("TRADE_SIZE_GBP", 2000, env),
      minSizeGbp: numberEnv("MIN_TRADE_SIZE_GBP", 250, env),
      feeBps: numberEnv("FEE_BPS", 4, env),
      slippageBps: numberEnv("SLIPPAGE_BPS", 4, env),
      maxOpenTradesPerPot: numberEnv("MAX_OPEN_TRADES_PER_POT", 5, env)
    },
    risk: {
      limitsEnabled: boolEnv("RISK_LIMITS_ENABLED", false, env),
      maxDailyLossGbp: numberEnv("MAX_DAILY_LOSS_GBP", 500, env),
      maxDrawdownPct: numberEnv("MAX_DRAWDOWN_PCT", 8, env),
      maxPortfolioExposurePct: numberEnv("MAX_PORTFOLIO_EXPOSURE_PCT", 50, env)
    },
    paperExecution: {
      enabled: boolEnv("PAPER_EXECUTION_ENABLED", false, env),
      testMode: paperTestMode,
      intervalMs: numberEnv("PAPER_EXECUTION_INTERVAL_MS", 60000, env),
      maxTradeAgeMs: numberEnv("PAPER_MAX_TRADE_AGE_MS", 1800000, env),
      minConfidence: numberEnv("PAPER_MIN_CONFIDENCE", paperTestMode ? 55 : 80, env),
      minSignals: numberEnv("PAPER_MIN_SIGNALS", paperTestMode ? 1 : 3, env),
      fixedTradeSizeGbp: numberEnv("PAPER_FIXED_TRADE_SIZE_GBP", 2000, env),
      maxScalpTrades: numberEnv("PAPER_MAX_SCALP_TRADES", 5, env),
      maxStrategyTrades: numberEnv("PAPER_MAX_STRATEGY_TRADES", 5, env),
      scalpPotGbp: numberEnv("PAPER_SCALP_POT_GBP", 10000, env),
      strategyPotGbp: numberEnv("PAPER_STRATEGY_POT_GBP", 10000, env),
      totalPotGbp: numberEnv("PAPER_TOTAL_POT_GBP", 10000, env),
      scalpWinnerBasketExitEnabled: boolEnv("PAPER_SCALP_WINNER_BASKET_EXIT_ENABLED", false, env),
      scalpWinnerBasketTargetGbp: numberEnv("PAPER_SCALP_WINNER_BASKET_TARGET_GBP", 25, env)
    }
  };
}

module.exports = { loadConfig, numberEnv, boolEnv, listEnv };
