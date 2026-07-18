#!/usr/bin/env bash
set -u

BASE_URL="${APEX_API:-http://localhost:3000}"
OUT="${WATCH_OUT:-data/overnight-watch.jsonl}"
INTERVAL="${WATCH_INTERVAL:-60}"

mkdir -p "$(dirname "$OUT")"

while true; do
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  TMP_BODY="$(mktemp)"
  HTTP_CODE="$(curl -sS --max-time 8 -o "$TMP_BODY" -w "%{http_code}" "$BASE_URL/api/dashboard/summary" 2>/tmp/apex-watch-curl.err || echo "000")"
  CURL_ERR="$(cat /tmp/apex-watch-curl.err 2>/dev/null || true)"

  if [ "$HTTP_CODE" = "200" ]; then
    node - "$TMP_BODY" >> "$OUT" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  source: 'summary',
  ok: true,
  totals: j.totals,
  sizing: j.sizing,
  modes: j.modes,
  openTrades: j.openTrades,
  symbols: j.symbols
}));
NODE
    rm -f "$TMP_BODY"
    sleep "$INTERVAL"
    continue
  fi

  HTTP_CODE_STATE="$(curl -sS --max-time 8 -o "$TMP_BODY" -w "%{http_code}" "$BASE_URL/api/state" 2>/tmp/apex-watch-curl.err || echo "000")"
  CURL_ERR_STATE="$(cat /tmp/apex-watch-curl.err 2>/dev/null || true)"

  if [ "$HTTP_CODE_STATE" = "200" ]; then
    node - "$TMP_BODY" >> "$OUT" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const j = JSON.parse(fs.readFileSync(file, 'utf8'));

const portfolios = j.portfolios || {};
const metrics = j.portfolioMetrics || j.metrics || {};

function arr(v) { return Array.isArray(v) ? v : []; }
function n(v) { return Number(v) || 0; }

const modes = Object.keys(portfolios).map(mode => {
  const p = portfolios[mode] || {};
  const m = metrics[mode] || {};
  const open = arr(p.openTrades);
  const closed = arr(p.closedTrades);

  const realized = n(m.realizedPnl) || closed.reduce((a,t)=>a+n(t.netPnl || t.pnl),0);
  const unrealized = n(m.unrealizedPnl);
  const exposure = n(m.openExposure) || open.reduce((a,t)=>a+n(t.size || t.sizeGbp || t.positionSizeGbp || 2000),0);
  const wins = closed.filter(t=>n(t.netPnl || t.pnl)>0).length;
  const losses = closed.filter(t=>n(t.netPnl || t.pnl)<=0).length;

  return {
    mode,
    openTrades: open.length,
    closedTrades: closed.length,
    openExposure: exposure,
    realizedPnl: realized,
    unrealizedPnl: unrealized,
    totalPnl: realized + unrealized,
    wins,
    losses
  };
});

const openTrades = arr(j.openTrades).length
  ? arr(j.openTrades)
  : Object.values(portfolios).flatMap(p => arr(p.openTrades));

const totals = {
  openTrades: openTrades.length,
  closedTrades: modes.reduce((a,m)=>a+n(m.closedTrades),0),
  exposure: modes.reduce((a,m)=>a+n(m.openExposure),0),
  realizedPnl: modes.reduce((a,m)=>a+n(m.realizedPnl),0),
  unrealizedPnl: modes.reduce((a,m)=>a+n(m.unrealizedPnl),0),
  totalPnl: modes.reduce((a,m)=>a+n(m.totalPnl),0),
  wins: modes.reduce((a,m)=>a+n(m.wins),0),
  losses: modes.reduce((a,m)=>a+n(m.losses),0)
};

console.log(JSON.stringify({
  ts: new Date().toISOString(),
  source: 'state',
  ok: true,
  totals,
  modes,
  openTrades
}));
NODE
  else
    printf '{"ts":"%s","source":"none","ok":false,"summaryHttp":"%s","stateHttp":"%s","summaryError":"%s","stateError":"%s"}\n' \
      "$TS" "$HTTP_CODE" "$HTTP_CODE_STATE" "$CURL_ERR" "$CURL_ERR_STATE" >> "$OUT"
  fi

  rm -f "$TMP_BODY"
  sleep "$INTERVAL"
done
