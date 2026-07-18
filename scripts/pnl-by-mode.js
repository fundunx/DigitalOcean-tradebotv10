const fs = require("fs");
const http = require("http");

const BASE_URL = process.env.APEXQUANT_URL || "http://localhost:3000";
const LEDGER = process.env.PAPER_LEDGER || "data/paper-trades.jsonl";

function money(v) {
  const n = Number(v || 0);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

function getJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
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

function ensureMode(summary, mode) {
  if (!summary[mode]) {
    summary[mode] = {
      mode,
      potGbp: 0,
      availableGbp: 0,
      openTrades: 0,
      closedTrades: 0,
      exposureGbp: 0,
      realizedPnlGbp: 0,
      unrealizedPnlGbp: 0,
      totalPnlGbp: 0
    };
  }

  return summary[mode];
}

function liveOpenPnl(state, trade) {
  const market = marketFor(state, trade.symbol);
  const current = Number(market?.price);
  const entry = Number(trade.entryPrice);
  const size = Number(trade.sizeGbp || 0);
  const direction = trade.side === "short" ? -1 : 1;

  if (!Number.isFinite(current) || !Number.isFinite(entry) || entry <= 0) {
    return 0;
  }

  const gross = size * (((current - entry) / entry) * direction);
  const estimatedRoundTripFees = size * 0.0008;

  return gross - estimatedRoundTripFees;
}

(async () => {
  const state = await getJson(`${BASE_URL}/api/state`);
  const rows = readJsonl(LEDGER);

  const summary = {};

  for (const mode of ["scalp", "strategy", "unknown"]) {
    ensureMode(summary, mode);
  }

  if (state?.paperPots) {
    for (const pot of state.paperPots) {
      const row = ensureMode(summary, String(pot.mode || "unknown").toLowerCase());
      row.potGbp = Number(pot.potGbp || 0);
      row.availableGbp = Number(pot.availableGbp || 0);
      row.exposureGbp = Number(pot.exposureGbp || 0);
      row.openTrades = Number(pot.openTrades || 0);
    }
  }

  const ledgerClosed = rows
    .filter(row => row.type === "paper.trade.closed")
    .map(row => row.trade)
    .filter(Boolean);

  const liveClosed = state?.closedTrades || [];

  const closedById = new Map();

  for (const trade of ledgerClosed) {
    if (trade.id) closedById.set(trade.id, trade);
  }

  for (const trade of liveClosed) {
    if (trade.id && !closedById.has(trade.id)) closedById.set(trade.id, trade);
  }

  const closedTrades = [...closedById.values()];

  for (const trade of closedTrades) {
    const row = ensureMode(summary, modeOf(trade));
    row.closedTrades += 1;
    row.realizedPnlGbp += Number(trade.pnlGbp || 0);
  }

  const openTrades = state?.openTrades || [];

  for (const trade of openTrades) {
    const row = ensureMode(summary, modeOf(trade));
    row.openTrades = Math.max(row.openTrades, 0) + (state?.paperPots ? 0 : 1);
    row.exposureGbp += state?.paperPots ? 0 : Number(trade.sizeGbp || 0);
    row.unrealizedPnlGbp += liveOpenPnl(state, trade);
  }

  for (const row of Object.values(summary)) {
    row.totalPnlGbp = row.realizedPnlGbp + row.unrealizedPnlGbp;
  }

  const rowsOut = Object.values(summary)
    .filter(row =>
      row.mode !== "unknown" ||
      row.openTrades ||
      row.closedTrades ||
      row.realizedPnlGbp ||
      row.unrealizedPnlGbp
    );

  const totals = rowsOut.reduce((acc, row) => {
    acc.potGbp += row.potGbp;
    acc.availableGbp += row.availableGbp;
    acc.openTrades += row.openTrades;
    acc.closedTrades += row.closedTrades;
    acc.exposureGbp += row.exposureGbp;
    acc.realizedPnlGbp += row.realizedPnlGbp;
    acc.unrealizedPnlGbp += row.unrealizedPnlGbp;
    acc.totalPnlGbp += row.totalPnlGbp;
    return acc;
  }, {
    mode: "TOTAL",
    potGbp: 0,
    availableGbp: 0,
    openTrades: 0,
    closedTrades: 0,
    exposureGbp: 0,
    realizedPnlGbp: 0,
    unrealizedPnlGbp: 0,
    totalPnlGbp: 0
  });

  console.log("");
  console.log("APEXQUANT PNL BY MODE");
  console.log("=====================");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`API: ${state ? "online" : "offline"}`);
  console.log("");

  console.log(
    [
      "MODE".padEnd(12),
      "OPEN".padStart(5),
      "CLOSED".padStart(7),
      "POT".padStart(12),
      "EXPOSURE".padStart(12),
      "AVAILABLE".padStart(12),
      "REALIZED".padStart(12),
      "UNREALIZED".padStart(12),
      "TOTAL".padStart(12)
    ].join(" ")
  );

  console.log("-".repeat(112));

  for (const row of [...rowsOut, totals]) {
    console.log(
      [
        row.mode.toUpperCase().padEnd(12),
        String(row.openTrades).padStart(5),
        String(row.closedTrades).padStart(7),
        (`£${row.potGbp.toFixed(2)}`).padStart(12),
        (`£${row.exposureGbp.toFixed(2)}`).padStart(12),
        (`£${row.availableGbp.toFixed(2)}`).padStart(12),
        money(row.realizedPnlGbp).padStart(12),
        money(row.unrealizedPnlGbp).padStart(12),
        money(row.totalPnlGbp).padStart(12)
      ].join(" ")
    );
  }

  console.log("");
})();
