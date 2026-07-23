const fs = require("fs");
const path = require("path");
const {
  calculateTradePnl,
  estimateRoundTripFees
} = require("../portfolio/portfolioPnl");

function appendPaperTradeLedger(type, trade) {
  const dataDir = process.env.DATA_DIR || "data";
  const file = path.join(dataDir, "paper-trades.jsonl");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify({
    type,
    at: new Date().toISOString(),
    trade
  }) + "\n");
}

function paperBrokerStateFile() {
  const dataDir = process.env.DATA_DIR;
  return dataDir ? path.join(dataDir, "paper-broker-state.json") : null;
}

function loadPaperBrokerState() {
  const file = paperBrokerStateFile();
  if (!file || !fs.existsSync(file)) return null;

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function persistPaperBrokerState(broker) {
  const file = paperBrokerStateFile();
  if (!file) return;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    cashGbp: broker.cashGbp,
    openTrades: broker.openTrades,
    closedTrades: broker.closedTrades,
    feesPaidGbp: broker.feesPaidGbp
  }, null, 2));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function entryFeeForTrade(trade, fallbackFeeBps) {
  const storedEntryFee = finiteNumber(trade.entryFeeGbp);
  if (storedEntryFee !== null) return storedEntryFee;

  const legacyFee = finiteNumber(trade.fee);
  if (legacyFee !== null) return legacyFee;

  return estimateRoundTripFees({
    sizeGbp: trade.sizeGbp,
    feeBps: fallbackFeeBps
  }).entryFeeGbp;
}

function netPnlForClosedTrade(trade) {
  const reportedPnl = Number(trade.pnlGbp || 0);

  if (trade.pnlIncludesEntryFee === true) {
    return reportedPnl;
  }

  return reportedPnl - entryFeeForTrade(trade, 4);
}

class PaperBroker {
  constructor({ startingBalanceGbp = 20000, feeBps = 4 } = {}) {
    const recovered = loadPaperBrokerState();

    this.feeBps = Number.isFinite(Number(feeBps)) ? Number(feeBps) : 4;
    this.cashGbp = Number(
      recovered?.cashGbp ?? recovered?.portfolio?.cashGbp ?? startingBalanceGbp
    );
    this.openTrades = Array.isArray(recovered?.openTrades) ? recovered.openTrades : [];
    this.closedTrades = Array.isArray(recovered?.closedTrades) ? recovered.closedTrades : [];
    this.feesPaidGbp = Number(
      recovered?.feesPaidGbp ?? recovered?.portfolio?.feesPaidGbp ?? 0
    );
  }

  open(decision, price) {
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("valid live entry price required");
    }
    if (!decision.symbol) throw new Error("paper trade requires symbol");
    if (!decision.side) throw new Error("paper trade requires side");
    if (!Number.isFinite(decision.stopLossPct) || decision.stopLossPct <= 0) {
      throw new Error("paper trade requires positive stopLossPct");
    }
    if (!Number.isFinite(decision.targetPct) || decision.targetPct <= 0) {
      throw new Error("paper trade requires positive targetPct");
    }

    const fees = estimateRoundTripFees({
      sizeGbp: decision.sizeGbp,
      feeBps: this.feeBps
    });

    const trade = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      symbol: decision.symbol,
      side: decision.side,
      potName: decision.potName || decision.tradeMode || "unassigned",
      tradeMode: decision.tradeMode || decision.potName || "unassigned",
      sizeGbp: decision.sizeGbp,
      entryPrice: price,
      openedAt: new Date().toISOString(),
      entryReason: decision.entryReason,
      stopLossPct: decision.stopLossPct,
      targetPct: decision.targetPct,
      confidence: decision.confidence,
      expectedValue: decision.expectedValue,
      fee: fees.entryFeeGbp,
      entryFeeGbp: fees.entryFeeGbp,
      feeBps: this.feeBps
    };

    this.cashGbp -= fees.entryFeeGbp;
    this.feesPaidGbp += fees.entryFeeGbp;
    this.openTrades.push(trade);

    persistPaperBrokerState(this);
    appendPaperTradeLedger("paper.trade.opened", trade);
    return trade;
  }

  close(id, price, exitReason = "paper close") {
    const index = this.openTrades.findIndex((trade) => trade.id === id);
    if (index === -1) return null;

    const [trade] = this.openTrades.splice(index, 1);
    const feeBps = finiteNumber(trade.feeBps) ?? this.feeBps;
    const entryFeeGbp = entryFeeForTrade(trade, feeBps);
    const exitFeeGbp = estimateRoundTripFees({
      sizeGbp: trade.sizeGbp,
      feeBps
    }).exitFeeGbp;

    const pnl = calculateTradePnl({
      side: trade.side,
      sizeGbp: trade.sizeGbp,
      entryPrice: trade.entryPrice,
      exitPrice: price,
      entryFeeGbp,
      exitFeeGbp
    });

    const closed = {
      ...trade,
      fee: entryFeeGbp,
      entryFeeGbp,
      exitPrice: price,
      exitReason,
      grossPnlGbp: pnl.grossPnlGbp,
      exitFeeGbp,
      closeFee: exitFeeGbp,
      totalCostsGbp: pnl.totalCostsGbp,
      pnlGbp: pnl.netPnlGbp,
      pnlIncludesEntryFee: true,
      cashChangeGbp: pnl.grossPnlGbp - exitFeeGbp,
      closedAt: new Date().toISOString()
    };

    this.closedTrades.push(closed);

    /*
     * Entry fee was deducted at open. Add only gross P&L minus exit fee here
     * so cash does not deduct the entry fee a second time.
     */
    this.cashGbp += closed.cashChangeGbp;
    this.feesPaidGbp += exitFeeGbp;

    persistPaperBrokerState(this);
    appendPaperTradeLedger("paper.trade.closed", closed);
    return closed;
  }

  metrics() {
    const wins = this.closedTrades.filter(
      (trade) => netPnlForClosedTrade(trade) > 0
    ).length;

    return {
      cashGbp: this.cashGbp,
      openTrades: this.openTrades.length,
      closedTrades: this.closedTrades.length,
      feesPaidGbp: this.feesPaidGbp,
      realizedPnlGbp: this.closedTrades.reduce(
        (sum, trade) => sum + netPnlForClosedTrade(trade),
        0
      ),
      winRate: this.closedTrades.length ? wins / this.closedTrades.length : 0
    };
  }
}

module.exports = { PaperBroker };
