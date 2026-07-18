#!/usr/bin/env bash

URL="${APEXQUANT_URL:-http://localhost:3000}"

while true; do
  clear
  echo "APEXQUANT SAFE LIVE WATCH"
  echo "Time: $(date -Is)"
  echo "URL:  $URL"
  echo

  if ! curl -fsS --max-time 5 "$URL/api/state" > /tmp/apex-state.json; then
    echo "BOT API IS NOT RESPONDING"
    echo
    echo "Process check:"
    pgrep -af "node src/index.js" || echo "NO BOT PROCESS RUNNING"
    echo
    echo "Last 80 log lines:"
    tail -80 logs/apexquant-v10.log 2>/dev/null || true
    sleep 5
    continue
  fi

  node - <<'NODE'
const fs = require("fs");

const state = JSON.parse(fs.readFileSync("/tmp/apex-state.json", "utf8"));

function money(v) {
  const n = Number(v || 0);
  return `${n >= 0 ? "+" : "-"}£${Math.abs(n).toFixed(2)}`;
}

function pct(v) {
  const n = Number(v || 0);
  return `${n >= 0 ? "+" : "-"}${Math.abs(n).toFixed(3)}%`;
}

function age(openedAt) {
  const ms = Date.now() - new Date(openedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`;
}

function marketsArray(state) {
  if (Array.isArray(state.markets)) return state.markets;
  if (state.markets && Array.isArray(state.markets.markets)) return state.markets.markets;
  if (state.markets && typeof state.markets === "object") return Object.values(state.markets);
  return [];
}

function findMarket(symbol) {
  const s = String(symbol || "").toLowerCase();
  return marketsArray(state).find((m) => String(m.symbol || "").toLowerCase() === s);
}

function line(title) {
  console.log("");
  console.log("=".repeat(100));
  console.log(title);
  console.log("=".repeat(100));
}

console.log(`mode: ${state.mode}`);
console.log(`liveTradingLocked: ${state.liveTradingLocked}`);
console.log(`cash: ${money(state.portfolio?.cashGbp)} | realized: ${money(state.portfolio?.realizedPnlGbp)} | fees: ${money(state.portfolio?.feesPaidGbp)}`);
console.log(`openTrades: ${(state.openTrades || []).length} | closedTrades: ${(state.closedTrades || []).length}`);

line("PAPER POTS");

if (Array.isArray(state.paperPots) && state.paperPots.length) {
  for (const pot of state.paperPots) {
    console.log(`${String(pot.mode).toUpperCase()} | ${pot.openTrades}/${pot.maxTrades} trades | pot £${Number(pot.potGbp || 0).toFixed(2)} | exposure £${Number(pot.exposureGbp || 0).toFixed(2)} | available £${Number(pot.availableGbp || 0).toFixed(2)}`);
  }
} else {
  console.log("paperPots not present in /api/state yet");
}

line("OPEN TRADES / LIVE PNL");

const openTrades = state.openTrades || [];

if (!openTrades.length) {
  console.log("No open trades.");
}

for (const trade of openTrades) {
  const market = findMarket(trade.symbol);
  const currentPrice = Number(market?.price);
  const entryPrice = Number(trade.entryPrice);
  const direction = trade.side === "short" ? -1 : 1;

  const pnlPct =
    Number.isFinite(currentPrice) &&
    Number.isFinite(entryPrice) &&
    entryPrice > 0
      ? ((currentPrice - entryPrice) / entryPrice) * 100 * direction
      : 0;

  const grossPnl = Number(trade.sizeGbp || 0) * pnlPct / 100;
  const estimatedFees = Number(trade.sizeGbp || 0) * 0.0008;
  const netPnl = grossPnl - estimatedFees;

  console.log(`${String(trade.tradeMode || trade.potName || "unknown").toUpperCase()} | ${trade.symbol} ${String(trade.side || "").toUpperCase()} | size £${Number(trade.sizeGbp || 0).toFixed(2)} | age ${age(trade.openedAt)}`);
  console.log(`  entry ${entryPrice || "?"} | current ${Number.isFinite(currentPrice) ? currentPrice : "?"} | live pnl ${pct(pnlPct)} | approx net ${money(netPnl)}`);
  console.log(`  stop ${trade.stopLossPct ?? "?"}% | target ${trade.targetPct ?? "?"}% | confidence ${trade.confidence ?? "?"}`);
  console.log(`  reason: ${trade.entryReason || "not recorded"}`);
}

line("RECENT EVENTS");

const events = state.events || [];
if (!events.length) {
  console.log("No recent events.");
}

for (const event of events.slice(-12).reverse()) {
  console.log(`${event.at || ""} ${event.type || "event"} ${event.data?.symbol || event.symbol || ""} ${event.data?.reason || event.reason || ""}`);
}

line("CONTROLS");
console.log("Stop watcher: Ctrl+C");
console.log("Stop bot:     pkill -f \"node src/index.js\"");
NODE

  sleep 5
done
