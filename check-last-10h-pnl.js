cat > /var/www/apexquant-v6/check-last-10h-pnl.js
const fs = require("fs");

const API_URL = "http://localhost:8091/api/state";
const STATE_FILE = "/var/www/apexquant-v6/data/state-v6.json";

const HOURS = 10;
const sinceMs = Date.now() - HOURS * 60 * 60 * 1000;

function money(n) {
  const num = Number(n || 0);
  return `£${num.toFixed(2)}`;
}

function pct(n) {
  const num = Number(n || 0);
  return `${num.toFixed(2)}%`;
}

function findArray(obj, names) {
  for (const name of names) {
    if (Array.isArray(obj?.[name])) return obj[name];
  }
  return [];
}

function getTimeMs(trade) {
  const possible = [
    trade.closedAt,
    trade.closeTime,
    trade.exitTime,
    trade.updatedAt,
    trade.time,
    trade.timestamp,
    trade.createdAt,
    trade.openedAt,
    trade.entryTime,
  ];

  for (const value of possible) {
    if (!value) continue;

    if (typeof value === "number") {
      return value > 9999999999 ? value : value * 1000;
    }

    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }

  return 0;
}

function getPnl(trade) {
  const possible = [
    trade.netPnlGbp,
    trade.netPnl,
    trade.pnlGbp,
    trade.realizedPnlGbp,
    trade.realizedPnl,
    trade.pnl,
    trade.profit,
  ];

  for (const value of possible) {
    if (value !== undefined && value !== null && value !== "") {
      return Number(String(value).replace("£", "").replace(",", ""));
    }
  }

  return 0;
}

function getOpenPnl(trade) {
  const possible = [
    trade.unrealizedPnlGbp,
    trade.unrealizedPnl,
    trade.livePnlGbp,
    trade.currentPnlGbp,
    trade.pnlGbp,
    trade.pnl,
  ];

  for (const value of possible) {
    if (value !== undefined && value !== null && value !== "") {
      return Number(String(value).replace("£", "").replace(",", ""));
    }
  }

  return 0;
}

async function loadState() {
  try {
    const res = await fetch(API_URL);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // fallback to file below
  }

  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

(async () => {
  const state = await loadState();

  const closedTrades = [
    ...findArray(state, ["closedTrades", "tradeHistory", "history", "tradesClosed"]),
    ...findArray(state?.scalp, ["closedTrades", "tradeHistory", "history", "tradesClosed"]),
    ...findArray(state?.strategy, ["closedTrades", "tradeHistory", "history", "tradesClosed"]),
  ];

  const openTrades = [
    ...findArray(state, ["openTrades", "positions", "activeTrades"]),
    ...findArray(state?.scalp, ["openTrades", "positions", "activeTrades"]),
    ...findArray(state?.strategy, ["openTrades", "positions", "activeTrades"]),
  ];

  const recentClosed = closedTrades
    .filter(t => getTimeMs(t) >= sinceMs)
    .sort((a, b) => getTimeMs(b) - getTimeMs(a));

  const totalClosedPnl = recentClosed.reduce((sum, t) => sum + getPnl(t), 0);
  const wins = recentClosed.filter(t => getPnl(t) > 0);
  const losses = recentClosed.filter(t => getPnl(t) < 0);

  const openPnl = openTrades.reduce((sum, t) => sum + getOpenPnl(t), 0);

  console.log("");
  console.log("====================================");
  console.log(`LAST ${HOURS} HOURS TRADE CHECK`);
  console.log("====================================");
  console.log(`Closed trades: ${recentClosed.length}`);
  console.log(`Wins: ${wins.length}`);
  console.log(`Losses: ${losses.length}`);
  console.log(`Closed PnL: ${money(totalClosedPnl)}`);
  console.log(`Open trades: ${openTrades.length}`);
  console.log(`Open unrealised PnL: ${money(openPnl)}`);
  console.log(`Total PnL incl open: ${money(totalClosedPnl + openPnl)}`);
  console.log("====================================");
  console.log("");

  if (!recentClosed.length) {
    console.log("No closed trades found in the last 10 hours.");
  } else {
    console.table(
      recentClosed.map(t => ({
        time: new Date(getTimeMs(t)).toLocaleString("en-GB"),
        mode: t.mode || t.pot || t.strategy || t.strategyName || "",
        symbol: t.symbol || t.pair || "",
        side: t.side || "",
        entry: t.entryPrice || t.entry || "",
        exit: t.exitPrice || t.exit || "",
        pnl: money(getPnl(t)),
        pnlPercent: t.pnlPercent !== undefined ? pct(t.pnlPercent) : "",
        reason: t.exitReason || t.reason || t.closeReason || "",
      }))
    );
  }

  console.log("");
})();

