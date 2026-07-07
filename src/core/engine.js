const { MarketCache } = require("../market/marketCache");
const { Scanner } = require("../strategy/scanner");
const { DecisionEngine } = require("../strategy/decisionEngine");
const { RiskEngine } = require("../risk/riskEngine");
const { PaperBroker } = require("../execution/paperBroker");
const { WhatIf } = require("../learning/whatIf");
const { LearningAdvisor } = require("../learning/learningAdvisor");
const { EventStore } = require("../storage/eventStore");
const { DecisionJournal } = require("../journal/decisionJournal");

class Engine {
  constructor(config) {
    this.config = config;
    this.cache = new MarketCache();
    this.scanner = new Scanner({ cache: this.cache, config });
    this.decisions = new DecisionEngine({ config });
    this.risk = new RiskEngine({ config });
    this.broker = new PaperBroker({ startingBalanceGbp: config.startingBalanceGbp });
    this.whatIf = new WhatIf();
    this.advisor = new LearningAdvisor();
    this.events = new EventStore();
    this.decisionJournal = new DecisionJournal({ dataDir: config.dataDir });
    this.startedAt = new Date().toISOString();
  }

  seedPaperMarket() {
    this.config.symbols.forEach((symbol, index) => {
      // No fake startup prices. Real market data must populate the cache.
    });
  }


  reviewDecisions({ persist = false, context = {} } = {}) {
    const candidates = this.scanner.scan();

    const reviews = candidates.map((candidate) => {
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

    if (persist) {
      this.decisionJournal.appendBatch({ reviews, context });
    }

    return reviews;
  }

  recentDecisionReviews(limit = 50) {
    return this.decisionJournal.recent(limit);
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


  closeManagedPaperTrades({ now = Date.now(), reasonPrefix = "paper execution" } = {}) {
    const closed = [];

    for (const trade of [...this.broker.openTrades]) {
      const market = this.cache.markets.get(trade.symbol);
      if (!market || !Number.isFinite(market.price) || market.price <= 0) continue;

      const direction = trade.side === "short" ? -1 : 1;
      const pnlPct = ((market.price - trade.entryPrice) / trade.entryPrice) * 100 * direction;
      const ageMs = now - new Date(trade.openedAt).getTime();

      let exitReason = null;
      if (pnlPct <= -Math.abs(trade.stopLossPct)) {
        exitReason = `${reasonPrefix}: stop loss hit`;
      } else if (pnlPct >= Math.abs(trade.targetPct)) {
        exitReason = `${reasonPrefix}: profit target hit`;
      } else if (ageMs >= this.config.paperExecution.maxTradeAgeMs) {
        exitReason = `${reasonPrefix}: max trade age reached`;
      }

      if (exitReason) {
        const closedTrade = this.broker.close(trade.id, market.price, exitReason);
        if (closedTrade) {
          closed.push(closedTrade);
          this.events.append("paper.trade.closed", closedTrade);
        }
      }
    }

    return closed;
  }

  runPaperExecutionCycle({ source = "paper.execution.cycle" } = {}) {
    if (this.config.mode !== "paper" || !this.config.liveTradingLocked) {
      throw new Error("paper execution requires paper mode with live trading locked");
    }

    if (!this.config.paperExecution.enabled) {
      return {
        enabled: false,
        opened: [],
        closed: [],
        reviews: [],
        reason: "paper execution disabled"
      };
    }

    const closed = this.closeManagedPaperTrades({ reasonPrefix: source });
    const closedSymbols = new Set(closed.map((trade) => trade.symbol));

    const reviews = this.reviewDecisions({
      persist: true,
      context: {
        source,
        mode: this.config.mode,
        paperOnly: true,
        opensTrades: true,
        testMode: this.config.paperExecution.testMode
      }
    });

    const opened = [];

    for (const review of reviews) {
      if (!review.risk.approved) continue;
      if (closedSymbols.has(review.symbol)) continue;

      const market = this.cache.markets.get(review.symbol);
      if (!market || !Number.isFinite(market.price) || market.price <= 0) continue;

      const executionDecision = {
        ...review.decision,
        symbol: review.decision.symbol || review.symbol,
        side: review.decision.side || review.side || "long",
        stopLossPct: Number.isFinite(review.decision.stopLossPct) ? review.decision.stopLossPct : 0.8,
        targetPct: Number.isFinite(review.decision.targetPct) ? review.decision.targetPct : 1.2,
        entryReason: review.decision.entryReason || review.scanner?.reason || "paper execution approved setup"
      };

      const trade = this.broker.open(executionDecision, market.price);
      opened.push(trade);
      this.events.append("paper.trade.opened", trade);
    }

    return {
      enabled: true,
      opened,
      closed,
      reviews
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
