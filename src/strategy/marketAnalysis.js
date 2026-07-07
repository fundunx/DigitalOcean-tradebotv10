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
  const signals = [];

  if (market.realMarketData !== true) blockers.push("market data is not marked as real");
  if (!Number.isFinite(market.price) || market.price <= 0) blockers.push("missing valid live price");
  if (!Number.isFinite(market.bid) || !Number.isFinite(market.ask)) blockers.push("missing bid/ask");
  if (candles.length < 60) blockers.push("need at least 60 one-minute candles");
  if (spreadPct === null) blockers.push("missing spread");
  if (spreadPct !== null && spreadPct > 0.08) blockers.push(`spread too wide (${spreadPct.toFixed(4)}%)`);

  if (trend15mPct > 0.12) signals.push("15m trend positive");
  if (trend30mPct > 0.18) signals.push("30m trend positive");
  if (momentum5mPct > 0.05) signals.push("5m momentum positive");
  if (relativeVolume > 1.15) signals.push("recent volume above baseline");
  if (momentum1mPct < -0.18) blockers.push("latest candle shows sharp downside momentum");

  let score = 0;
  if (market.realMarketData === true) score += 20;
  if (candles.length >= 60) score += 15;
  if (spreadPct !== null && spreadPct <= 0.03) score += 15;
  if (trend15mPct > 0.12) score += 15;
  if (trend30mPct > 0.18) score += 10;
  if (momentum5mPct > 0.05) score += 10;
  if (relativeVolume > 1.15) score += 10;
  if (trend60mPct > 0.25) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

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
    score,
    signals,
    blockers
  };
}

module.exports = { analyseMarket };
