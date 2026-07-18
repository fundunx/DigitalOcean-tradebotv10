const fs = require("fs");

const file = process.env.PAPER_LEDGER || "data/paper-trades.jsonl";

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

const rows = readJsonl(file);

const opened = rows
  .filter(row => row.type === "paper.trade.opened")
  .map(row => row.trade);

const closed = rows
  .filter(row => row.type === "paper.trade.closed")
  .map(row => row.trade);

const closedIds = new Set(closed.map(t => t.id));
const stillOpen = opened.filter(t => !closedIds.has(t.id));

const realizedPnl = closed.reduce((sum, t) => sum + Number(t.pnlGbp || 0), 0);
const grossPnl = closed.reduce((sum, t) => sum + Number(t.grossPnlGbp || t.pnlGbp || 0), 0);
const fees = opened.reduce((sum, t) => sum + Number(t.fee || 0), 0) +
  closed.reduce((sum, t) => sum + Number(t.closeFee || 0), 0);

function byMode(trades, valueFn) {
  const result = {};

  for (const trade of trades) {
    const mode = trade.tradeMode || trade.potName || "unknown";
    if (!result[mode]) {
      result[mode] = {
        count: 0,
        sizeGbp: 0,
        pnlGbp: 0
      };
    }

    result[mode].count += 1;
    result[mode].sizeGbp += Number(trade.sizeGbp || 0);
    result[mode].pnlGbp += Number(valueFn(trade) || 0);
  }

  return result;
}

console.log("");
console.log("APEXQUANT PAPER TRADE LEDGER REPORT");
console.log("===================================");
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Ledger: ${file}`);
console.log("");

console.log(`Ledger rows: ${rows.length}`);
console.log(`Opened trades: ${opened.length}`);
console.log(`Closed trades: ${closed.length}`);
console.log(`Still open by ledger: ${stillOpen.length}`);
console.log(`Realized net PnL: ${money(realizedPnl)}`);
console.log(`Gross closed PnL: ${money(grossPnl)}`);
console.log(`Known fees: ${money(fees)}`);

console.log("");
console.log("PNL BY MODE");
console.log("===========");

const modeSummary = byMode(closed, t => t.pnlGbp);

if (!Object.keys(modeSummary).length) {
  console.log("No closed trades yet.");
}

for (const [mode, s] of Object.entries(modeSummary)) {
  console.log(`${mode.toUpperCase()} | closed ${s.count} | size £${s.sizeGbp.toFixed(2)} | realized ${money(s.pnlGbp)}`);
}

console.log("");
console.log("OPEN TRADES");
console.log("===========");

if (!stillOpen.length) {
  console.log("No open trades in ledger.");
}

for (const trade of stillOpen) {
  console.log(`${String(trade.tradeMode || trade.potName || "unknown").toUpperCase()} | ${trade.symbol} ${String(trade.side || "").toUpperCase()} | size £${Number(trade.sizeGbp || 0).toFixed(2)} | entry ${trade.entryPrice} | confidence ${trade.confidence}`);
  console.log(`  opened: ${trade.openedAt}`);
  console.log(`  reason: ${trade.entryReason || "not recorded"}`);
}

console.log("");
console.log("CLOSED TRADES");
console.log("=============");

if (!closed.length) {
  console.log("No closed trades in ledger.");
}

for (const trade of closed.slice().reverse()) {
  const entry = Number(trade.entryPrice);
  const exit = Number(trade.exitPrice);
  const direction = trade.side === "short" ? -1 : 1;
  const pnlPct = Number.isFinite(entry) && entry > 0 && Number.isFinite(exit)
    ? ((exit - entry) / entry) * 100 * direction
    : 0;

  console.log(`${String(trade.tradeMode || trade.potName || "unknown").toUpperCase()} | ${trade.symbol} ${String(trade.side || "").toUpperCase()} | size £${Number(trade.sizeGbp || 0).toFixed(2)} | net ${money(trade.pnlGbp)} | ${pct(pnlPct)}`);
  console.log(`  entry ${trade.entryPrice} | exit ${trade.exitPrice}`);
  console.log(`  opened: ${trade.openedAt}`);
  console.log(`  closed: ${trade.closedAt}`);
  console.log(`  exit reason: ${trade.exitReason || "not recorded"}`);
}
