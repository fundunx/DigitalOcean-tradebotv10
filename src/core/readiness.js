function readiness({ config, feedHealth }) {
  const blockers = [];
  const warnings = [];

  if (config.mode !== "paper") blockers.push("mode must remain paper");
  if (!config.liveTradingLocked) blockers.push("live trading lock must remain enabled");
  if (!feedHealth || feedHealth.stale) warnings.push("market feed is stale or not started");

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    mode: config.mode,
    liveTradingLocked: config.liveTradingLocked
  };
}

module.exports = { readiness };
