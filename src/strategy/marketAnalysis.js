function pctChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return 0;
  return ((to - from) / from) * 100;
}

function average(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function analyseMarket(market) {
  const candles = Array.isArray(market.candles1m) ? market.candles1m : [];
  const closes = candles.map((candle) => Number(candle.close)).filter(Number.isFinite);
  const volumes = candles.map((candle) => Number(candle.volume)).filter(Number.isFinite);

  const latestClose = closes.at(-1);
  const previousClose = closes.at(-2);
  const close5 = closes.at(-6);
  const close15 = closes.at(-16);
  const close30 = closes.at(-31);
  const close60 = closes.at(0);

  const momentum1mPct = pctChange(previousClose, latestClose);
  const momentum5mPct = pctChange(close5, latestClose);
  const trend15mPct = pctChange(close15, latestClose);
  const trend30mPct = pctChange(close30, latestClose);
  const trend60mPct = pctChange(close60, latestClose);

  const recentVolume = average(volumes.slice(-5));
  const baselineVolume = average(volumes.slice(0, -5));
  const relativeVolume = baselineVolume > 0 ? recentVolume / baselineVolume : 0;

  const spreadPct = Number.isFinite(market.spread) && Number.isFinite(market.price) && market.price > 0
    ? (market.spread / market.price) * 100
    : null;

  const blockers = [];

  if (market.realMarketData !== true) blockers.push("market data is not marked as real");
  if (!Number.isFinite(market.price) || market.price <= 0) blockers.push("missing valid live price");
  if (!Number.isFinite(market.bid) || !Number.isFinite(market.ask)) blockers.push("missing bid/ask");
  if (candles.length < 60) blockers.push("need at least 60 one-minute candles");
  if (spreadPct === null) blockers.push("missing spread");
  if (spreadPct !== null && spreadPct > 0.08) blockers.push(`spread too wide (${spreadPct.toFixed(4)}%)`);

  const bullishSignals = [];
  const bearishSignals = [];

  if (trend15mPct > 0.12) bullishSignals.push("15m trend positive");
  if (trend30mPct > 0.18) bullishSignals.push("30m trend positive");
  if (momentum5mPct > 0.05) bullishSignals.push("5m momentum positive");
  if (relativeVolume > 1.15) bullishSignals.push("recent volume above baseline");

  if (trend15mPct < -0.12) bearishSignals.push("15m trend negative");
  if (trend30mPct < -0.18) bearishSignals.push("30m trend negative");
  if (momentum5mPct < -0.05) bearishSignals.push("5m momentum negative");
  if (relativeVolume > 1.15) bearishSignals.push("recent volume above baseline");

  const sharedScore = (
    (market.realMarketData === true ? 20 : 0)
    + (candles.length >= 60 ? 15 : 0)
    + (spreadPct !== null && spreadPct <= 0.03 ? 15 : 0)
  );

  const bullishScore = sharedScore
    + (trend15mPct > 0.12 ? 15 : 0)
    + (trend30mPct > 0.18 ? 10 : 0)
    + (momentum5mPct > 0.05 ? 10 : 0)
    + (relativeVolume > 1.15 ? 10 : 0)
    + (trend60mPct > 0.25 ? 5 : 0);

  const bearishScore = sharedScore
    + (trend15mPct < -0.12 ? 15 : 0)
    + (trend30mPct < -0.18 ? 10 : 0)
    + (momentum5mPct < -0.05 ? 10 : 0)
    + (relativeVolume > 1.15 ? 10 : 0)
    + (trend60mPct < -0.25 ? 5 : 0);

  const bullishConfirmed = (
    trend15mPct > 0.12
    && trend30mPct > 0.18
    && momentum5mPct > 0.05
    && relativeVolume > 1.15
  );

  const bearishConfirmed = (
    trend15mPct < -0.12
    && trend30mPct < -0.18
    && momentum5mPct < -0.05
    && relativeVolume > 1.15
  );

  let regime = "neutral";
  let signals = [];
  let score = sharedScore;

  if (bullishConfirmed && !bearishConfirmed) {
    regime = "bullish";
    signals = bullishSignals;

    if (momentum1mPct < -0.18) {
      blockers.push("latest candle shows sharp downside momentum");
    }

    score = bullishScore;
  } else if (bearishConfirmed && !bullishConfirmed) {
    regime = "bearish";
    signals = bearishSignals;

    if (momentum1mPct > 0.18) {
      blockers.push("latest candle shows sharp upside momentum");
    }

    score = bearishScore;
  } else {
    blockers.push("no aligned bullish or bearish market regime");
  }

  return {
    symbol: market.symbol,
    price: market.price,
    realMarketData: market.realMarketData === true,
    candleCount: candles.length,
    spreadPct,
    momentum1mPct,
    momentum5mPct,
    trend15mPct,
    trend30mPct,
    trend60mPct,
    relativeVolume,
    regime,
    score: Math.max(0, Math.min(100, Math.round(score))),
    signals,
    blockers
  };
}

module.exports = { analyseMarket };
