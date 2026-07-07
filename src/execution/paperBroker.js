class PaperBroker {
  constructor({ startingBalanceGbp = 20000 } = {}) {
    this.cashGbp = startingBalanceGbp;
    this.openTrades = [];
    this.closedTrades = [];
    this.feesPaidGbp = 0;
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
    this.cashGbp += netPnl;
    this.feesPaidGbp += closeFee;
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
