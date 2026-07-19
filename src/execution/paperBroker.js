const fs = require("fs");
const path = require("path");

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

class PaperBroker {
  constructor({ startingBalanceGbp = 20000 } = {}) {
    const recovered = loadPaperBrokerState();

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
    if (!Number.isFinite(price) || price <= 0) throw new Error("valid live entry price required");
    if (!decision.symbol) throw new Error("paper trade requires symbol");
    if (!decision.side) throw new Error("paper trade requires side");
    if (!Number.isFinite(decision.stopLossPct) || decision.stopLossPct <= 0) {
      throw new Error("paper trade requires positive stopLossPct");
    }
    if (!Number.isFinite(decision.targetPct) || decision.targetPct <= 0) {
      throw new Error("paper trade requires positive targetPct");
    }

    const fee = decision.sizeGbp * 0.0004;
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
      fee
    };
    this.cashGbp -= fee;
    this.feesPaidGbp += fee;
    this.openTrades.push(trade);
    persistPaperBrokerState(this);
    appendPaperTradeLedger("paper.trade.opened", trade);
    return trade;
  }

  close(id, price, exitReason = "paper close") {
    const index = this.openTrades.findIndex((trade) => trade.id === id);
    if (index === -1) return null;
    const [trade] = this.openTrades.splice(index, 1);
    const direction = trade.side === "short" ? -1 : 1;
    const pnl = trade.sizeGbp * ((price - trade.entryPrice) / trade.entryPrice) * direction;
    const closeFee = trade.sizeGbp * 0.0004;
    const netPnl = pnl - closeFee;
    const closed = {
      ...trade,
      exitPrice: price,
      exitReason,
      pnlGbp: netPnl,
      grossPnlGbp: pnl,
      closeFee,
      closedAt: new Date().toISOString()
    };
    this.closedTrades.push(closed);
    appendPaperTradeLedger("paper.trade.closed", closed);
    this.cashGbp += netPnl;
    this.feesPaidGbp += closeFee;
    persistPaperBrokerState(this);
    return closed;
  }

  metrics() {
    const wins = this.closedTrades.filter((trade) => trade.pnlGbp > 0).length;
    return {
      cashGbp: this.cashGbp,
      openTrades: this.openTrades.length,
      closedTrades: this.closedTrades.length,
      feesPaidGbp: this.feesPaidGbp,
      realizedPnlGbp: this.closedTrades.reduce((sum, trade) => sum + trade.pnlGbp, 0),
      winRate: this.closedTrades.length ? wins / this.closedTrades.length : 0
    };
  }
}

module.exports = { PaperBroker };
