const fs = require("fs");

const LEDGER = process.env.PAPER_LEDGER || "data/paper-trades.jsonl";
const DECISIONS = process.env.DECISION_JOURNAL || "data/decision-reviews.jsonl";
const OUT_JSON = process.env.OUT_JSON || "data/deep-trade-analysis.json";

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

function money(v) {
  const n = Number(v || 0);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

function pct(v) {
  const n = Number(v || 0);
  const sign = n >= 0 ? "+" : "-";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function num(v) {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function std(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = mean(values.map(v => (v - m) ** 2));
  return Math.sqrt(variance);
}

function min(values) {
  return values.length ? Math.min(...values) : 0;
}

function max(values) {
  return values.length ? Math.max(...values) : 0;
}

function modeOf(trade) {
  return String(trade.tradeMode || trade.potName || "unknown").toLowerCase();
}

function symbolOf(trade) {
  return String(trade.symbol || "unknown").toLowerCase();
}

function sideOf(trade) {
  return String(trade.side || "unknown").toLowerCase();
}

function pnlOf(trade) {
  return num(trade.pnlGbp);
}

function grossPnlOf(trade) {
  return num(trade.grossPnlGbp || trade.pnlGbp);
}

function feeOf(trade) {
  return num(trade.fee) + num(trade.closeFee);
}

function holdMs(trade) {
  const start = new Date(trade.openedAt).getTime();
  const end = new Date(trade.closedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, end - start);
}

function holdMinutes(trade) {
  return holdMs(trade) / 60000;
}

function pnlPctOf(trade) {
  const entry = num(trade.entryPrice);
  const exit = num(trade.exitPrice);
  if (!entry || !exit) return 0;
  const direction = sideOf(trade) === "short" ? -1 : 1;
  return ((exit - entry) / entry) * 100 * direction;
}

function confidenceOf(trade) {
  return num(trade.confidence);
}

function confidenceBucket(trade) {
  const c = confidenceOf(trade);
  if (c >= 90) return "90-100";
  if (c >= 80) return "80-89";
  if (c >= 70) return "70-79";
  if (c >= 60) return "60-69";
  if (c >= 50) return "50-59";
  return "0-49";
}

function holdBucket(trade) {
  const m = holdMinutes(trade);
  if (m < 1) return "<1m";
  if (m < 3) return "1-3m";
  if (m < 5) return "3-5m";
  if (m < 10) return "5-10m";
  if (m < 30) return "10-30m";
  if (m < 60) return "30-60m";
  return "60m+";
}

function exitReasonOf(trade) {
  return String(trade.exitReason || "unknown").toLowerCase();
}

function entryReasonOf(trade) {
  return String(trade.entryReason || "unknown").toLowerCase();
}

function signalTags(trade) {
  const reason = entryReasonOf(trade);
  const tags = [];

  const checks = [
    ["5m momentum", "5m momentum"],
    ["15m trend", "15m trend"],
    ["30m trend", "30m trend"],
    ["60m trend", "60m trend"],
    ["volume", "volume"],
    ["breakout", "breakout"],
    ["regime", "regime"],
    ["scalp", "scalp"],
    ["strategy", "strategy"],
    ["qualified setup", "qualified setup"]
  ];

  for (const [needle, tag] of checks) {
    if (reason.includes(needle)) tags.push(tag);
  }

  if (!tags.length) tags.push("unknown");
  return tags;
}

function hourBucket(trade) {
  const d = new Date(trade.openedAt);
  if (Number.isNaN(d.getTime())) return "unknown";
  return String(d.getUTCHours()).padStart(2, "0") + ":00 UTC";
}

function groupBy(trades, keyFn) {
  const map = new Map();

  for (const trade of trades) {
    const key = keyFn(trade);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(trade);
  }

  return [...map.entries()].map(([key, group]) => ({
    key,
    ...stats(group)
  })).sort((a, b) => a.totalPnlGbp - b.totalPnlGbp);
}

function stats(trades) {
  const pnls = trades.map(pnlOf);
  const grossPnls = trades.map(grossPnlOf);
  const fees = trades.map(feeOf);
  const wins = trades.filter(t => pnlOf(t) > 0);
  const losses = trades.filter(t => pnlOf(t) < 0);
  const flats = trades.filter(t => pnlOf(t) === 0);

  const totalPnlGbp = pnls.reduce((a, b) => a + b, 0);
  const grossPnlGbp = grossPnls.reduce((a, b) => a + b, 0);
  const totalFeesGbp = fees.reduce((a, b) => a + b, 0);

  const grossWins = wins.reduce((a, t) => a + pnlOf(t), 0);
  const grossLosses = Math.abs(losses.reduce((a, t) => a + pnlOf(t), 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    flats: flats.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    totalPnlGbp,
    grossPnlGbp,
    totalFeesGbp,
    averagePnlGbp: mean(pnls),
    medianPnlGbp: median(pnls),
    minPnlGbp: min(pnls),
    maxPnlGbp: max(pnls),
    pnlStdGbp: std(pnls),
    averagePnlPct: mean(trades.map(pnlPctOf)),
    medianPnlPct: median(trades.map(pnlPctOf)),
    averageHoldMinutes: mean(trades.map(holdMinutes)),
    medianHoldMinutes: median(trades.map(holdMinutes)),
    profitFactor
  };
}

function losingStreaks(trades) {
  const ordered = [...trades].sort((a, b) => new Date(a.closedAt) - new Date(b.closedAt));

  let current = 0;
  let maxStreak = 0;
  let streaks = [];

  for (const trade of ordered) {
    if (pnlOf(trade) < 0) {
      current += 1;
      maxStreak = Math.max(maxStreak, current);
    } else {
      if (current > 0) streaks.push(current);
      current = 0;
    }
  }

  if (current > 0) streaks.push(current);

  return {
    maxLosingStreak: maxStreak,
    averageLosingStreak: mean(streaks),
    streaks
  };
}

function topBottom(rows, minTrades = 5) {
  const eligible = rows.filter(r => r.trades >= minTrades);
  return {
    worst: eligible.slice().sort((a, b) => a.totalPnlGbp - b.totalPnlGbp).slice(0, 15),
    best: eligible.slice().sort((a, b) => b.totalPnlGbp - a.totalPnlGbp).slice(0, 15)
  };
}

function formatRow(row) {
  return [
    String(row.key).padEnd(22),
    String(row.trades).padStart(6),
    `${(row.winRate * 100).toFixed(1)}%`.padStart(8),
    money(row.totalPnlGbp).padStart(12),
    money(row.averagePnlGbp).padStart(12),
    money(row.medianPnlGbp).padStart(12),
    row.profitFactor === Infinity ? "INF".padStart(8) : row.profitFactor.toFixed(2).padStart(8),
    `${row.medianHoldMinutes.toFixed(1)}m`.padStart(10)
  ].join(" ");
}

function printTable(title, rows, limit = 30) {
  console.log("");
  console.log(title);
  console.log("=".repeat(title.length));
  console.log([
    "KEY".padEnd(22),
    "TRADES".padStart(6),
    "WIN%".padStart(8),
    "TOTAL".padStart(12),
    "AVG".padStart(12),
    "MEDIAN".padStart(12),
    "PF".padStart(8),
    "MED HOLD".padStart(10)
  ].join(" "));
  console.log("-".repeat(96));

  if (!rows.length) {
    console.log("No data.");
    return;
  }

  for (const row of rows.slice(0, limit)) {
    console.log(formatRow(row));
  }
}

function printStats(title, s) {
  console.log("");
  console.log(title);
  console.log("=".repeat(title.length));
  console.log(`Trades: ${s.trades}`);
  console.log(`Wins / Losses / Flats: ${s.wins} / ${s.losses} / ${s.flats}`);
  console.log(`Win rate: ${(s.winRate * 100).toFixed(2)}%`);
  console.log(`Total net PnL: ${money(s.totalPnlGbp)}`);
  console.log(`Gross PnL before known fees: ${money(s.grossPnlGbp)}`);
  console.log(`Known fees: ${money(s.totalFeesGbp)}`);
  console.log(`Average PnL/trade: ${money(s.averagePnlGbp)}`);
  console.log(`Median PnL/trade: ${money(s.medianPnlGbp)}`);
  console.log(`Best / Worst trade: ${money(s.maxPnlGbp)} / ${money(s.minPnlGbp)}`);
  console.log(`Average PnL %: ${s.averagePnlPct.toFixed(4)}%`);
  console.log(`Median PnL %: ${s.medianPnlPct.toFixed(4)}%`);
  console.log(`Average hold: ${s.averageHoldMinutes.toFixed(2)}m`);
  console.log(`Median hold: ${s.medianHoldMinutes.toFixed(2)}m`);
  console.log(`Profit factor: ${s.profitFactor === Infinity ? "INF" : s.profitFactor.toFixed(3)}`);
}

function recommendations(analysis) {
  const recs = [];

  if (analysis.overall.totalPnlGbp < 0) {
    recs.push({
      severity: "critical",
      area: "overall",
      finding: `Closed-trade expectancy is negative: ${money(analysis.overall.averagePnlGbp)} per trade.`,
      action: "Keep £2,000 test size if consistency is required, but halt low-quality entries and reduce trade frequency. Do not lower size as the primary fix."
    });
  }

  if (analysis.overall.profitFactor < 1) {
    recs.push({
      severity: "critical",
      area: "profit_factor",
      finding: `Profit factor is ${analysis.overall.profitFactor.toFixed(3)}, below break-even.`,
      action: "Require higher expected net edge after fees/spread before entry."
    });
  }

  for (const mode of analysis.byMode) {
    if (mode.trades >= 20 && mode.totalPnlGbp < 0) {
      recs.push({
        severity: "high",
        area: `mode:${mode.key}`,
        finding: `${mode.key} is losing: ${money(mode.totalPnlGbp)} across ${mode.trades} trades.`,
        action: `Tighten ${mode.key} entry criteria; add cooldown after loss streaks; stop opening fresh ${mode.key} trades during negative expectancy windows.`
      });
    }
  }

  const badSymbols = analysis.bySymbol
    .filter(s => s.trades >= 5 && s.totalPnlGbp < -10)
    .slice(0, 10);

  if (badSymbols.length) {
    recs.push({
      severity: "high",
      area: "symbols",
      finding: `Worst symbols: ${badSymbols.map(s => `${s.key} ${money(s.totalPnlGbp)}`).join(", ")}`,
      action: "Temporarily quarantine symbols with repeated negative expectancy. Keep collecting reviews, but do not trade them until edge improves."
    });
  }

  const badSignals = analysis.bySignal
    .filter(s => s.trades >= 10 && s.totalPnlGbp < 0)
    .slice(0, 10);

  if (badSignals.length) {
    recs.push({
      severity: "high",
      area: "signals",
      finding: `Losing signal groups: ${badSignals.map(s => `${s.key} ${money(s.totalPnlGbp)}`).join(", ")}`,
      action: "Require losing signal groups to be paired with stronger confirmation instead of trading them alone."
    });
  }

  const quickLosses = analysis.byHoldBucket
    .filter(s => ["<1m", "1-3m", "3-5m"].includes(s.key))
    .reduce((sum, s) => sum + s.totalPnlGbp, 0);

  if (quickLosses < 0) {
    recs.push({
      severity: "medium",
      area: "holding_time",
      finding: `Fast exits under 5 minutes are net losing: ${money(quickLosses)}.`,
      action: "Review stop/target/trailing logic. Entries may be too late or stops too tight for current volatility."
    });
  }

  if (analysis.streaks.maxLosingStreak >= 5) {
    recs.push({
      severity: "high",
      area: "loss_streak",
      finding: `Max losing streak is ${analysis.streaks.maxLosingStreak}.`,
      action: "Add automatic cooldown after 3 consecutive losses per mode and per symbol."
    });
  }

  return recs;
}

const ledgerRows = readJsonl(LEDGER);
const decisionRows = readJsonl(DECISIONS);

const opened = ledgerRows
  .filter(r => r.type === "paper.trade.opened")
  .map(r => r.trade)
  .filter(Boolean);

const closed = ledgerRows
  .filter(r => r.type === "paper.trade.closed")
  .map(r => r.trade)
  .filter(Boolean);

const closedIds = new Set(closed.map(t => t.id));
const openByLedger = opened.filter(t => !closedIds.has(t.id));

const byMode = groupBy(closed, modeOf);
const bySymbol = groupBy(closed, symbolOf);
const bySide = groupBy(closed, sideOf);
const byExitReason = groupBy(closed, exitReasonOf);
const byEntryReason = groupBy(closed, entryReasonOf);
const byConfidence = groupBy(closed, confidenceBucket);
const byHoldBucket = groupBy(closed, holdBucket);
const byHour = groupBy(closed, hourBucket);

const signalExpanded = [];
for (const trade of closed) {
  for (const tag of signalTags(trade)) {
    signalExpanded.push({
      ...trade,
      __signalTag: tag
    });
  }
}
const bySignal = groupBy(signalExpanded, t => t.__signalTag);

const overall = stats(closed);
const streaks = losingStreaks(closed);

const symbolRank = topBottom(bySymbol, 5);
const modeRank = topBottom(byMode, 5);
const signalRank = topBottom(bySignal, 10);
const exitRank = topBottom(byExitReason, 5);
const confidenceRank = topBottom(byConfidence, 5);

const analysis = {
  generatedAt: new Date().toISOString(),
  files: {
    ledger: LEDGER,
    decisions: DECISIONS
  },
  counts: {
    ledgerRows: ledgerRows.length,
    decisionRows: decisionRows.length,
    opened: opened.length,
    closed: closed.length,
    openByLedger: openByLedger.length
  },
  overall,
  streaks,
  byMode,
  bySymbol,
  bySide,
  byExitReason,
  byEntryReason,
  byConfidence,
  byHoldBucket,
  byHour,
  bySignal,
  rankings: {
    symbols: symbolRank,
    modes: modeRank,
    signals: signalRank,
    exitReasons: exitRank,
    confidence: confidenceRank
  }
};

analysis.recommendations = recommendations(analysis);

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(analysis, null, 2));

console.log("");
console.log("APEXQUANT DEEP TRADE ANALYSIS");
console.log("=============================");
console.log(`Generated: ${analysis.generatedAt}`);
console.log(`Ledger rows: ${analysis.counts.ledgerRows}`);
console.log(`Decision rows: ${analysis.counts.decisionRows}`);
console.log(`Opened: ${analysis.counts.opened}`);
console.log(`Closed: ${analysis.counts.closed}`);
console.log(`Still open by ledger: ${analysis.counts.openByLedger}`);
console.log(`Output JSON: ${OUT_JSON}`);

printStats("OVERALL CLOSED TRADE PERFORMANCE", overall);

console.log("");
console.log("LOSS STREAKS");
console.log("============");
console.log(`Max losing streak: ${streaks.maxLosingStreak}`);
console.log(`Average losing streak: ${streaks.averageLosingStreak.toFixed(2)}`);

printTable("BY MODE", byMode.slice().sort((a, b) => a.totalPnlGbp - b.totalPnlGbp));
printTable("WORST SYMBOLS >= 5 TRADES", symbolRank.worst);
printTable("BEST SYMBOLS >= 5 TRADES", symbolRank.best);
printTable("BY EXIT REASON", byExitReason.slice().sort((a, b) => a.totalPnlGbp - b.totalPnlGbp));
printTable("BY CONFIDENCE BUCKET", byConfidence.slice().sort((a, b) => a.key.localeCompare(b.key)));
printTable("BY HOLD TIME BUCKET", byHoldBucket);
printTable("BY UTC HOUR", byHour.slice().sort((a, b) => a.key.localeCompare(b.key)));
printTable("BY SIGNAL TAG", bySignal.slice().sort((a, b) => a.totalPnlGbp - b.totalPnlGbp));

console.log("");
console.log("RECOMMENDED LEARNING CHANGES");
console.log("============================");

if (!analysis.recommendations.length) {
  console.log("No recommendations generated.");
} else {
  for (const rec of analysis.recommendations) {
    console.log(`[${rec.severity.toUpperCase()}] ${rec.area}`);
    console.log(`  finding: ${rec.finding}`);
    console.log(`  action:  ${rec.action}`);
  }
}

console.log("");
console.log("NOTE");
console.log("====");
console.log("This analysis keeps £2,000 trade sizing assumption intact.");
console.log("It does not recommend reducing trade size as the primary fix.");
console.log("The goal is to identify which modes/symbols/signals/timing buckets are bad and block or tighten them.");
