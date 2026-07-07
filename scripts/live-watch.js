const BASE = process.env.APEXQUANT_URL || "http://localhost:3000";
const REFRESH_MS = Number(process.env.REFRESH_MS || 5000);

function gbp(v) {
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

async function json(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
}

function marketsArray(state) {
  if (Array.isArray(state.markets)) return state.markets;
  if (state.markets && Array.isArray(state.markets.markets)) return state.markets.markets;
  if (state.markets && typeof state.markets === "object") return Object.values(state.markets);
  return [];
}

function findMarket(state, symbol) {
  const s = String(symbol || "").toLowerCase();
  return marketsArray(state).find((m) => String(m.symbol || "").toLowerCase() === s);
}

function rule(title) {
  console.log("\n" + "═".repeat(100));
  console.log(title);
  console.log("═".repeat(100));
}

async function draw() {
  const [state, thinking] = await Promise.all([
    json("/api/state"),
    json("/api/decisions/review").catch(() => ({ reviews: [] }))
  ]);

  console.clear();
  console.log(`APEXQUANT V10 LIVE PAPER WATCH | ${new Date().toISOString()}`);
  console.log(`mode: ${state.mode} | liveTradingLocked: ${state.liveTradingLocked}`);
  console.log(`cash: ${gbp(state.portfolio?.cashGbp)} | realized: ${gbp(state.portfolio?.realizedPnlGbp)} | fees: ${gbp(state.portfolio?.feesPaidGbp)}`);

  rule("PAPER POTS");
  for (const pot of state.paperPots || []) {
    console.log(`${pot.mode.toUpperCase()} | ${pot.openTrades}/${pot.maxTrades} trades | pot £${Number(pot.potGbp).toFixed(2)} | exposure £${Number(pot.exposureGbp).toFixed(2)} | available £${Number(pot.availableGbp).toFixed(2)}`);
  }

  rule("OPEN TRADES / LIVE PNL");
  const openTrades = state.openTrades || [];
  if (!openTrades.length) console.log("No open paper trades right now.");

  for (const trade of openTrades) {
    const market = findMarket(state, trade.symbol);
    const currentPrice = Number(market?.price);
    const entryPrice = Number(trade.entryPrice);
    const direction = trade.side === "short" ? -1 : 1;
    const pnlPct = Number.isFinite(currentPrice) && Number.isFinite(entryPrice) && entryPrice > 0
      ? ((currentPrice - entryPrice) / entryPrice) * 100 * direction
      : 0;
    const grossPnl = Number(trade.sizeGbp || 0) * pnlPct / 100;
    const estimatedFees = Number(trade.sizeGbp || 0) * 0.0008;
    const netPnl = grossPnl - estimatedFees;

    console.log(`${String(trade.tradeMode || trade.potName || "unknown").toUpperCase()} | ${trade.symbol} ${String(trade.side || "").toUpperCase()} | size £${Number(trade.sizeGbp || 0).toFixed(2)} | age ${age(trade.openedAt)}`);
    console.log(`  entry ${entryPrice || "?"} | current ${Number.isFinite(currentPrice) ? currentPrice : "?"} | pnl ${pct(pnlPct)} | approx net ${gbp(netPnl)}`);
    console.log(`  stop ${trade.stopLossPct}% | target ${trade.targetPct}% | confidence ${trade.confidence}`);
    console.log(`  reason: ${trade.entryReason || "not recorded"}`);
  }

  rule("CURRENT THINKING");
  const reviews = Array.isArray(thinking) ? thinking : thinking.reviews || thinking.decisions || [];
  if (!reviews.length) console.log("No decision reviews available.");

  for (const review of reviews.slice(0, 10)) {
    const scanner = review.scanner || {};
    const decision = review.decision || {};
    const risk = review.risk || {};
    const approved = Boolean(decision.approved || risk.approved);
    console.log(`${review.symbol || "UNKNOWN"} | ${approved ? "APPROVED" : "REJECTED"} | confidence ${decision.confidence ?? scanner.score ?? "?"}`);
    console.log(`  scanner: ${scanner.reason || decision.scannerReason || "no scanner reason"}`);
    console.log(`  risk: ${risk.reason || decision.rejectionReason || "no risk reason"}`);
  }

  rule("CONTROLS");
  console.log("Stop watcher: Ctrl+C");
  console.log("Stop bot: pkill -f 'node src/index.js'");
}

async function loop() {
  try {
    await draw();
  } catch (error) {
    console.clear();
    console.log("Watcher error:", error.message);
  }
}

loop();
setInterval(loop, REFRESH_MS);
