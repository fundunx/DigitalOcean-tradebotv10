const fs = require("fs");
const path = require("path");
const http = require("http");

const BASE_URL = process.env.APEXQUANT_URL || "http://localhost:3000";

function money(value) {
  const n = Number(value || 0);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

function pct(value) {
  const n = Number(value || 0);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(3)}%`;
}

function age(openedAt, closedAt = null) {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const ms = end - start;
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}m ${secs}s`;
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => body += chunk);
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Timeout from ${url}`));
    });
  });
}

function marketsArray(state) {
  if (Array.isArray(state.markets)) return state.markets;
  if (state.markets && Array.isArray(state.markets.markets)) return state.markets.markets;
  if (state.markets && typeof state.markets === "object") return Object.values(state.markets);
  return [];
}

function findMarket(state, symbol) {
  const target = String(symbol || "").toLowerCase();
  return marketsArray(state).find((market) => String(market.symbol || "").toLowerCase() === target);
}

function openTradePnl(state, trade) {
  const market = findMarket(state, trade.symbol);
  const currentPrice = Number(market?.price);
  const entryPrice = Number(trade.entryPrice);
  const sizeGbp = Number(trade.sizeGbp || 0);
  const direction = trade.side === "short" ? -1 : 1;

  if (!Number.isFinite(currentPrice) || !Number.isFinite(entryPrice) || entryPrice <= 0) {
    return {
      currentPrice: null,
      pnlPct: 0,
      grossPnlGbp: 0,
      estimatedFeesGbp: sizeGbp * 0.0008,
      netPnlGbp: -(sizeGbp * 0.0008)
    };
  }

  const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100 * direction;
  const grossPnlGbp = sizeGbp * (pnlPct / 100);
  const estimatedFeesGbp = sizeGbp * 0.0008;
  const netPnlGbp = grossPnlGbp - estimatedFeesGbp;

  return {
    currentPrice,
    pnlPct,
    grossPnlGbp,
    estimatedFeesGbp,
    netPnlGbp
  };
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];

  return fs.readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function findDataEvents() {
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) return [];

  const files = fs.readdirSync(dataDir)
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => path.join(dataDir, file));

  const events = [];

  for (const file of files) {
    for (const row of readJsonl(file)) {
      events.push({
        file,
        ...row
      });
    }
  }

  return events;
}

function eventPayload(event) {
  return event.data || event.payload || event.trade || event;
}

function summarizeByMode(rows, valueFn) {
  const summary = {};

  for (const row of rows) {
    const mode = row.tradeMode || row.potName || "unknown";
    if (!summary[mode]) {
      summary[mode] = {
        count: 0,
        pnlGbp: 0,
        exposureGbp: 0
      };
    }

    summary[mode].count += 1;
    summary[mode].pnlGbp += Number(valueFn(row) || 0);
    summary[mode].exposureGbp += Number(row.sizeGbp || 0);
  }

  return summary;
}

function printSection(title) {
  console.log("");
  console.log("=".repeat(110));
  console.log(title);
  console.log("=".repeat(110));
}

(async () => {
  let state = null;

  try {
    state = await getJson(`${BASE_URL}/api/state`);
  } catch (error) {
    console.error(`WARNING: Could not read live API state: ${error.message}`);
  }

  const dataEvents = findDataEvents();

  const persistedOpened = dataEvents
    .filter((event) => event.type === "paper.trade.opened")
    .map(eventPayload);

  const persistedClosed = dataEvents
    .filter((event) => event.type === "paper.trade.closed")
    .map(eventPayload);

  const openTrades = state?.openTrades || [];
  const closedTrades = state?.closedTrades || [];

  const liveOpenIds = new Set(openTrades.map((trade) => trade.id));
  const liveClosedIds = new Set(closedTrades.map((trade) => trade.id));

  const extraPersistedOpened = persistedOpened.filter((trade) => trade.id && !liveOpenIds.has(trade.id) && !liveClosedIds.has(trade.id));
  const extraPersistedClosed = persistedClosed.filter((trade) => trade.id && !liveClosedIds.has(trade.id));

  const allClosed = [...closedTrades, ...extraPersistedClosed];
  const allOpen = [...openTrades];

  const realizedPnl = allClosed.reduce((sum, trade) => sum + Number(trade.pnlGbp || 0), 0);
  const grossRealizedPnl = allClosed.reduce((sum, trade) => sum + Number(trade.grossPnlGbp || trade.pnlGbp || 0), 0);
  const closeFees = allClosed.reduce((sum, trade) => sum + Number(trade.closeFee || 0), 0);

  const openWithPnl = allOpen.map((trade) => ({
    ...trade,
    livePnl: state ? openTradePnl(state, trade) : {
      currentPrice: null,
      pnlPct: 0,
      grossPnlGbp: 0,
      estimatedFeesGbp: 0,
      netPnlGbp: 0
    }
  }));

  const unrealizedNetPnl = openWithPnl.reduce((sum, trade) => sum + Number(trade.livePnl.netPnlGbp || 0), 0);
  const unrealizedGrossPnl = openWithPnl.reduce((sum, trade) => sum + Number(trade.livePnl.grossPnlGbp || 0), 0);
  const openExposure = allOpen.reduce((sum, trade) => sum + Number(trade.sizeGbp || 0), 0);

  const totalApproxNetPnl = realizedPnl + unrealizedNetPnl;

  console.log("");
  console.log("APEXQUANT PAPER TRADE REPORT");
  console.log(`Generated: ${new Date().toISOString()}`);
  console.log(`API: ${BASE_URL}`);
  console.log("");

  console.log(`Mode: ${state?.mode || "unknown"}`);
  console.log(`Live trading locked: ${state?.liveTradingLocked}`);
  console.log(`Open trades: ${allOpen.length}`);
  console.log(`Closed trades: ${allClosed.length}`);
  console.log(`Open exposure: £${openExposure.toFixed(2)}`);
  console.log(`Realized net PnL: ${money(realizedPnl)}`);
  console.log(`Unrealized approx net PnL: ${money(unrealizedNetPnl)}`);
  console.log(`Total approx net PnL: ${money(totalApproxNetPnl)}`);
  console.log(`Gross realized PnL: ${money(grossRealizedPnl)}`);
  console.log(`Gross unrealized PnL: ${money(unrealizedGrossPnl)}`);
  console.log(`Known close fees: ${money(closeFees)}`);

  if (state?.paperPots) {
    printSection("PAPER POTS");
    for (const pot of state.paperPots) {
      console.log(`${String(pot.mode).toUpperCase()} | ${pot.openTrades}/${pot.maxTrades} trades | pot £${Number(pot.potGbp || 0).toFixed(2)} | exposure £${Number(pot.exposureGbp || 0).toFixed(2)} | available £${Number(pot.availableGbp || 0).toFixed(2)}`);
    }
  }

  printSection("PNL BY MODE");

  const closedByMode = summarizeByMode(allClosed, (trade) => trade.pnlGbp);
  const openByMode = summarizeByMode(openWithPnl, (trade) => trade.livePnl.netPnlGbp);

  const modes = new Set([...Object.keys(closedByMode), ...Object.keys(openByMode)]);

  if (!modes.size) {
    console.log("No mode-level trade data yet.");
  }

  for (const mode of modes) {
    const closed = closedByMode[mode] || { count: 0, pnlGbp: 0, exposureGbp: 0 };
    const open = openByMode[mode] || { count: 0, pnlGbp: 0, exposureGbp: 0 };

    console.log(`${String(mode).toUpperCase()} | open ${open.count} | closed ${closed.count} | exposure £${open.exposureGbp.toFixed(2)} | realized ${money(closed.pnlGbp)} | unrealized ${money(open.pnlGbp)} | total ${money(closed.pnlGbp + open.pnlGbp)}`);
  }

  printSection("OPEN TRADES");

  if (!openWithPnl.length) {
    console.log("No open trades.");
  }

  for (const trade of openWithPnl) {
    console.log(`${String(trade.tradeMode || trade.potName || "unknown").toUpperCase()} | ${trade.symbol} ${String(trade.side || "").toUpperCase()} | size £${Number(trade.sizeGbp || 0).toFixed(2)} | age ${age(trade.openedAt)}`);
    console.log(`  entry ${trade.entryPrice} | current ${trade.livePnl.currentPrice ?? "?"} | live ${pct(trade.livePnl.pnlPct)} | approx net ${money(trade.livePnl.netPnlGbp)}`);
    console.log(`  stop ${trade.stopLossPct ?? "?"}% | target ${trade.targetPct ?? "?"}% | confidence ${trade.confidence ?? "?"}`);
    console.log(`  reason: ${trade.entryReason || "not recorded"}`);
  }

  printSection("CLOSED TRADES");

  if (!allClosed.length) {
    console.log("No closed trades.");
  }

  for (const trade of allClosed.slice().sort((a, b) => new Date(b.closedAt || 0) - new Date(a.closedAt || 0))) {
    console.log(`${String(trade.tradeMode || trade.potName || "unknown").toUpperCase()} | ${trade.symbol} ${String(trade.side || "").toUpperCase()} | size £${Number(trade.sizeGbp || 0).toFixed(2)} | net ${money(trade.pnlGbp)} | held ${age(trade.openedAt, trade.closedAt)}`);
    console.log(`  entry ${trade.entryPrice} | exit ${trade.exitPrice} | gross ${money(trade.grossPnlGbp || trade.pnlGbp)} | close fee ${money(trade.closeFee || 0)}`);
    console.log(`  exit reason: ${trade.exitReason || "not recorded"}`);
  }

  printSection("PERSISTED EVENT COUNTS");
  console.log(`JSONL paper.trade.opened events: ${persistedOpened.length}`);
  console.log(`JSONL paper.trade.closed events: ${persistedClosed.length}`);
  console.log(`Extra persisted opened not in live state: ${extraPersistedOpened.length}`);
  console.log(`Extra persisted closed not in live state: ${extraPersistedClosed.length}`);
})();
