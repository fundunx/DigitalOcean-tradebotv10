const fs = require("fs");
const http = require("http");

const LEDGER = process.env.PAPER_LEDGER || "data/paper-trades.jsonl";
const BASE_URL = process.env.APEXQUANT_URL || "http://localhost:3000";
const WINDOW_MS = Number(process.env.WINDOW_MINUTES || 60) * 60 * 1000;
const SINCE = Date.now() - WINDOW_MS;

function money(v) {
  const n = Number(v || 0);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

function pct(v) {
  const n = Number(v || 0);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(3)}%`;
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];

  return fs.readFileSync(file, "utf8")
    .split("\n")
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(null);
        }
      });
    });

    req.on("error", () => resolve(null));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function marketsArray(state) {
  if (!state) return [];
  if (Array.isArray(state.markets)) return state.markets;
  if (state.markets && Array.isArray(state.markets.markets)) return state.markets.markets;
  if (state.markets && typeof state.markets === "object") return Object.values(state.markets);
  return [];
}

function marketFor(state, symbol) {
  const target = String(symbol || "").toLowerCase();
  return marketsArray(state).find(m => String(m.symbol || "").toLowerCase() === target);
}

function modeOf(trade) {
  return String(trade.tradeMode || trade.potName || "unknown").toLowerCase();
}

function openedAtMs(trade) {
  return new Date(trade.openedAt || 0).getTime();
}

function closedAtMs(trade) {
  return new Date(trade.closedAt || 0).getTime();
}

function livePnl(state, trade) {
  const market = marketFor(state, trade.symbol);
  const current = Number(market?.price);
  const entry = Number(trade.entryPrice);
  const size = Number(trade.sizeGbp || 0);
  const direction = trade.side === "short" ? -1 : 1;

  if (!Number.isFinite(current) || !Number.isFinite(entry) || entry <= 0) {
    return {
      currentPrice: null,
      pnlPct: 0,
      netPnlGbp: 0
    };
  }

  const pnlPct = ((current - entry) / entry) * 100 * direction;
  const gross = size * (pnlPct / 100);
  const estimatedRoundTripFees = size * 0.0008;

  return {
    currentPrice: current,
    pnlPct,
    netPnlGbp: gross - estimatedRoundTripFees
  };
}

function ensure(summary, key) {
  if (!summary[key]) {
    summary[key] = {
      key,
      opened: 0,
      closed: 0,
      openNow: 0,
      exposureGbp: 0,
      realizedPnlGbp: 0,
      unrealizedPnlGbp: 0,
      totalPnlGbp: 0,
      wins: 0,
      losses: 0
    };
  }

  return summary[key];
}

(async () => {
  const state = await getJson(`${BASE_URL}/api/state`);
  const rows = readJsonl(LEDGER);

  const openedEvents = rows
    .filter(r => r.type === "paper.trade.opened")
    .map(r => r.trade)
    .filter(Boolean);

  const closedEvents = rows
    .filter(r => r.type === "paper.trade.closed")
    .map(r => r.trade)
    .filter(Boolean);

  const closedIds = new Set(closedEvents.map(t => t.id));
  const currentOpen = state?.openTrades || openedEvents.filter(t => !closedIds.has(t.id));

  const openedLastHour = openedEvents.filter(t => openedAtMs(t) >= SINCE);
  const closedLastHour = closedEvents.filter(t => closedAtMs(t) >= SINCE);
  const openNowFromLastHour = currentOpen.filter(t => openedAtMs(t) >= SINCE);

  const byMode = {};
  const bySymbol = {};

  for (const trade of openedLastHour) {
    const mode = ensure(byMode, modeOf(trade));
    const symbol = ensure(bySymbol, String(trade.symbol || "unknown").toLowerCase());

    mode.opened += 1;
    symbol.opened += 1;
  }

  for (const trade of closedLastHour) {
    const mode = ensure(byMode, modeOf(trade));
    const symbol = ensure(bySymbol, String(trade.symbol || "unknown").toLowerCase());
    const pnl = Number(trade.pnlGbp || 0);

    mode.closed += 1;
    mode.realizedPnlGbp += pnl;
    if (pnl > 0) mode.wins += 1;
    if (pnl < 0) mode.losses += 1;

    symbol.closed += 1;
    symbol.realizedPnlGbp += pnl;
    if (pnl > 0) symbol.wins += 1;
    if (pnl < 0) symbol.losses += 1;
  }

  for (const trade of openNowFromLastHour) {
    const live = livePnl(state, trade);
    const mode = ensure(byMode, modeOf(trade));
    const symbol = ensure(bySymbol, String(trade.symbol || "unknown").toLowerCase());

    mode.openNow += 1;
    mode.exposureGbp += Number(trade.sizeGbp || 0);
    mode.unrealizedPnlGbp += live.netPnlGbp;

    symbol.openNow += 1;
    symbol.exposureGbp += Number(trade.sizeGbp || 0);
    symbol.unrealizedPnlGbp += live.netPnlGbp;
  }

  for (const row of Object.values(byMode)) {
    row.totalPnlGbp = row.realizedPnlGbp + row.unrealizedPnlGbp;
  }

  for (const row of Object.values(bySymbol)) {
    row.totalPnlGbp = row.realizedPnlGbp + row.unrealizedPnlGbp;
  }

  const totals = {
    opened: openedLastHour.length,
    closed: closedLastHour.length,
    openNow: openNowFromLastHour.length,
    exposureGbp: openNowFromLastHour.reduce((s, t) => s + Number(t.sizeGbp || 0), 0),
    realizedPnlGbp: closedLastHour.reduce((s, t) => s + Number(t.pnlGbp || 0), 0),
    unrealizedPnlGbp: openNowFromLastHour.reduce((s, t) => s + livePnl(state, t).netPnlGbp, 0),
    wins: closedLastHour.filter(t => Number(t.pnlGbp || 0) > 0).length,
    losses: closedLastHour.filter(t => Number(t.pnlGbp || 0) < 0).length
  };
  totals.totalPnlGbp = totals.realizedPnlGbp + totals.unrealizedPnlGbp;

  console.log("");
  console.log("APEXQUANT LAST HOUR TRADE BREAKDOWN");
  console.log("===================================");
  console.log(`Now: ${new Date().toISOString()}`);
  console.log(`Window: last ${Math.round(WINDOW_MS / 60000)} minutes`);
  console.log(`API: ${state ? "online" : "offline"}`);
  console.log("");

  console.log("TOTAL");
  console.log("-----");
  console.log(`Opened: ${totals.opened}`);
  console.log(`Closed: ${totals.closed}`);
  console.log(`Open now from last hour: ${totals.openNow}`);
  console.log(`Wins / losses: ${totals.wins} / ${totals.losses}`);
  console.log(`Exposure: £${totals.exposureGbp.toFixed(2)}`);
  console.log(`Realized PnL: ${money(totals.realizedPnlGbp)}`);
  console.log(`Unrealized PnL: ${money(totals.unrealizedPnlGbp)}`);
  console.log(`Total last-hour PnL: ${money(totals.totalPnlGbp)}`);

  function printTable(title, rows) {
    console.log("");
    console.log(title);
    console.log("=".repeat(title.length));
    console.log(
      [
        "KEY".padEnd(18),
        "OPENED".padStart(7),
        "CLOSED".padStart(7),
        "OPEN".padStart(6),
        "W/L".padStart(8),
        "EXPOSURE".padStart(12),
        "REALIZED".padStart(12),
        "UNREAL".padStart(12),
        "TOTAL".padStart(12)
      ].join(" ")
    );
    console.log("-".repeat(104));

    if (!rows.length) {
      console.log("No trades.");
      return;
    }

    for (const row of rows) {
      console.log(
        [
          row.key.padEnd(18),
          String(row.opened).padStart(7),
          String(row.closed).padStart(7),
          String(row.openNow).padStart(6),
          `${row.wins}/${row.losses}`.padStart(8),
          (`£${row.exposureGbp.toFixed(2)}`).padStart(12),
          money(row.realizedPnlGbp).padStart(12),
          money(row.unrealizedPnlGbp).padStart(12),
          money(row.totalPnlGbp).padStart(12)
        ].join(" ")
      );
    }
  }

  printTable(
    "BY MODE",
    Object.values(byMode).sort((a, b) => a.key.localeCompare(b.key))
  );

  printTable(
    "BY SYMBOL",
    Object.values(bySymbol).sort((a, b) => a.totalPnlGbp - b.totalPnlGbp)
  );

  console.log("");
  console.log("RECENT CLOSED IN LAST HOUR");
  console.log("==========================");
  const recentClosed = closedLastHour
    .slice()
    .sort((a, b) => closedAtMs(b) - closedAtMs(a))
    .slice(0, 20);

  if (!recentClosed.length) {
    console.log("No closed trades in the last hour.");
  }

  for (const t of recentClosed) {
    console.log(`${t.closedAt} | ${modeOf(t).toUpperCase()} | ${t.symbol} ${String(t.side || "").toUpperCase()} | size £${Number(t.sizeGbp || 0).toFixed(2)} | pnl ${money(t.pnlGbp)} | reason ${t.exitReason || "unknown"}`);
  }

  console.log("");
})();
