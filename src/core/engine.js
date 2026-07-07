const { MarketCache } = require("../market/marketCache");
const { Scanner } = require("../strategy/scanner");
const { DecisionEngine } = require("../strategy/decisionEngine");
const { RiskEngine } = require("../risk/riskEngine");
const { PaperBroker } = require("../execution/paperBroker");
const { WhatIf } = require("../learning/whatIf");
const { LearningAdvisor } = require("../learning/learningAdvisor");
const { EventStore } = require("../storage/eventStore");

class Engine {
  constructor(config) {
    this.config = config;
    this.cache = new MarketCache();
    this.scanner = new Scanner({ cache: this.cache });
    this.decisions = new DecisionEngine({ config });
    this.risk = new RiskEngine({ config });
    this.broker = new PaperBroker({ startingBalanceGbp: config.startingBalanceGbp });
    this.whatIf = new WhatIf();
    this.advisor = new LearningAdvisor();
    this.events = new EventStore();
    this.startedAt = new Date().toISOString();
  }

  seedPaperMarket() {
    this.config.symbols.forEach((symbol, index) => {
      // No fake startup prices. Real market data must populate the cache.
    });
  }


  reviewDecisions() {
    const candidates = this.scanner.scan();

    return candidates.map((candidate) => {
      const decision = this.decisions.decide(candidate);
      const risk = this.risk.check(decision, this.broker.openTrades);

      return {
        symbol: candidate.symbol,
        side: candidate.side,
        scanner: {
          passed: candidate.passed,
          score: candidate.score,
          reason: candidate.reason,
          analysis: candidate.analysis
        },
        decision: {
          approved: decision.approved,
          confidence: decision.confidence,
          sizeGbp: decision.sizeGbp,
          expectedValue: decision.expectedValue,
          entryReason: decision.entryReason,
          scannerReason: decision.scannerReason,
          signalsUsed: decision.signalsUsed,
          riskLevel: decision.riskLevel,
          rejectionReason: decision.rejectionReason,
          alternatives: decision.alternatives
        },
        risk
      };
    });
  }

  evaluate() {
    const candidates = this.scanner.scan();
    const reviews = [];

    for (const candidate of candidates) {
      const decision = this.decisions.decide(candidate);
      const risk = this.risk.check(decision, this.broker.openTrades);
      const review = { candidate, decision, risk };
      reviews.push(review);
      this.whatIf.record(review);
      this.events.append("decision.reviewed", review);

      if (risk.approved) {
        const trade = this.broker.open(decision, this.cache.markets.get(candidate.symbol).price);
        this.events.append("paper.trade.opened", trade);
      }
    }

    return reviews;
  }


  summary(feedHealth = null) {
    const markets = this.cache.snapshot().map((market) => ({
      symbol: market.symbol,
      source: market.source,
      realMarketData: market.realMarketData === true,
      price: market.price,
      bid: market.bid,
      ask: market.ask,
      spread: market.spread,
      updatedAt: market.updatedAt,
      candles1m: Array.isArray(market.candles1m) ? market.candles1m.length : 0
    }));

    return {
      name: "ApexQuant V10",
      mode: this.config.mode,
      liveTradingLocked: this.config.liveTradingLocked,
      paperOnly: true,
      startedAt: this.startedAt,
      marketCount: markets.length,
      markets,
      portfolio: this.broker.metrics(),
      openTrades: this.broker.openTrades.length,
      closedTrades: this.broker.closedTrades.length,
      feedHealth,
      latestEvents: this.events.recent().slice(0, 10)
    };
  }

  state(feedHealth = null) {
    return {
      name: "ApexQuant V10",
      mode: this.config.mode,
      liveTradingLocked: this.config.liveTradingLocked,
      startedAt: this.startedAt,
      markets: this.cache.snapshot(),
      portfolio: this.broker.metrics(),
      openTrades: this.broker.openTrades,
      closedTrades: this.broker.closedTrades,
      learning: {
        recent: this.whatIf.recent(),
        advisor: this.advisor.advise(this.whatIf.records)
      },
      feedHealth,
      events: this.events.recent()
    };
  }
}

module.exports = { Engine };
