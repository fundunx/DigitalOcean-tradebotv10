const { MarketCache } = require("../market/marketCache");
const { Scanner } = require("../strategy/scanner");
const { DecisionEngine } = require("../strategy/decisionEngine");
const { RiskEngine } = require("../risk/riskEngine");
const { PaperBroker } = require("../execution/paperBroker");
const {
  selectScalpWinnerBasketExit,
  selectScalpSingleWinnerExits
} = require("../execution/scalpWinnerBasketExit");
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
    this.broker = new PaperBroker({ startingBalanceGbp: config.startingBalanceGbp, feeBps: config.trade.feeBps });
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


  closeScalpSingleWinners({ reasonPrefix = "paper execution" } = {}) {
    const targetGbp = this.config.paperExecution.scalpSingleWinnerTakeProfitGbp;
    const selection = selectScalpSingleWinnerExits({
      trades: this.broker.openTrades,
      targetGbp,
      feeRate: this.config.trade.feeBps / 10000,
      priceForSymbol: (symbol) => this.cache.markets.get(symbol)?.price
    });

    const closed = [];

    for (const winner of selection.winners) {
      const market = this.cache.markets.get(winner.trade.symbol);
      if (!market || !Number.isFinite(market.price) || market.price <= 0) continue;

      const exitReason =
        `${reasonPrefix}: scalp individual winner net £${winner.netPnlGbp.toFixed(2)} ` +
        `after fees reached £${selection.targetGbp.toFixed(2)} target`;

      const closedTrade = this.broker.close(winner.trade.id, market.price, exitReason);

      if (closedTrade) {
        closed.push(closedTrade);
        this.events.append("paper.trade.closed", closedTrade);
      }
    }

    return closed;
  }

  closeScalpWinnerBasket({ reasonPrefix = "paper execution" } = {}) {
    const execution = this.config.paperExecution;

    if (!execution.scalpWinnerBasketExitEnabled) return [];

    const selection = selectScalpWinnerBasketExit({
      trades: this.broker.openTrades,
      targetGbp: execution.scalpWinnerBasketTargetGbp,
      feeRate: this.config.trade.feeBps / 10000,
      priceForSymbol: (symbol) => this.cache.markets.get(symbol)?.price
    });

    if (!selection.targetReached) return [];

    const exitReason =
      `${reasonPrefix}: scalp winner basket net £${selection.projectedNetPnlGbp.toFixed(2)} ` +
      `after fees reached £${selection.targetGbp.toFixed(2)} target`;

    const closed = [];

    for (const winner of selection.winners) {
      const market = this.cache.markets.get(winner.trade.symbol);
      if (!market || !Number.isFinite(market.price) || market.price <= 0) continue;

      const closedTrade = this.broker.close(
        winner.trade.id,
        market.price,
        exitReason
      );

      if (closedTrade) {
        closed.push(closedTrade);
        this.events.append("paper.trade.closed", closedTrade);
      }
    }

    return closed;
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


  classifyPaperTradeMode(review) {
    const signals = [
      ...(review.decision?.signalsUsed || []),
      ...(review.scanner?.analysis?.signals || [])
    ].map((signal) => String(signal).toLowerCase());

    const joined = signals.join(" ");

    if (
      joined.includes("15m") ||
      joined.includes("30m") ||
      joined.includes("60m") ||
      joined.includes("trend") ||
      joined.includes("regime")
    ) {
      return "strategy";
    }

    return "scalp";
  }

  paperPotLimits(mode) {
    if (mode === "strategy") {
      return {
        mode: "strategy",
        maxTrades: this.config.paperExecution.maxStrategyTrades,
        potGbp: this.config.paperExecution.strategyPotGbp
      };
    }

    return {
      mode: "scalp",
      maxTrades: this.config.paperExecution.maxScalpTrades,
      potGbp: this.config.paperExecution.scalpPotGbp
    };
  }

  paperOpenTradesForMode(mode) {
    return this.broker.openTrades.filter((trade) => (trade.tradeMode || trade.potName || "scalp") === mode);
  }

  paperOpenExposureForMode(mode) {
    return this.paperOpenTradesForMode(mode).reduce((sum, trade) => sum + Number(trade.sizeGbp || 0), 0);
  }

  canOpenPaperTradeInMode(mode, sizeGbp) {
    const totalExposure = this.broker.openTrades.reduce(
      (sum, trade) => sum + Number(trade.sizeGbp || 0),
      0
    );
    const totalAvailable = this.config.paperExecution.totalPotGbp - totalExposure;

    if (sizeGbp > totalAvailable) {
      return {
        approved: false,
        reason: `paper allocation has £${totalAvailable.toFixed(2)} available, cannot open £${sizeGbp.toFixed(2)}`
      };
    }

    const limits = this.paperPotLimits(mode);
    const openTrades = this.paperOpenTradesForMode(mode);
    const exposure = this.paperOpenExposureForMode(mode);
    const available = limits.potGbp - exposure;

    if (openTrades.length >= limits.maxTrades) {
      return {
        approved: false,
        reason: `${mode} paper pot already has ${openTrades.length}/${limits.maxTrades} open trades`
      };
    }

    if (sizeGbp > available) {
      return {
        approved: false,
        reason: `${mode} paper pot has £${available.toFixed(2)} available, cannot open £${sizeGbp.toFixed(2)}`
      };
    }

    return {
      approved: true,
      available,
      exposure,
      maxTrades: limits.maxTrades,
      potGbp: limits.potGbp
    };
  }

  paperPotSummary() {
    return ["scalp", "strategy"].map((mode) => {
      const limits = this.paperPotLimits(mode);
      const openTrades = this.paperOpenTradesForMode(mode);
      const exposure = this.paperOpenExposureForMode(mode);

      return {
        mode,
        potGbp: limits.potGbp,
        maxTrades: limits.maxTrades,
        openTrades: openTrades.length,
        exposureGbp: exposure,
        availableGbp: limits.potGbp - exposure
      };
    });
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

    const singleWinnerClosed = this.closeScalpSingleWinners({ reasonPrefix: source });
    const basketClosed = this.closeScalpWinnerBasket({ reasonPrefix: source });
    const individuallyClosed = this.closeManagedPaperTrades({ reasonPrefix: source });
    const closed = [...singleWinnerClosed, ...basketClosed, ...individuallyClosed];
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
    const rankedReviews = [...reviews].sort((left, right) => {
      const leftConfidence = Number(left.decision?.confidence || 0);
      const rightConfidence = Number(right.decision?.confidence || 0);
      const leftExpectedValue = Number(left.decision?.expectedValue?.netPct || 0);
      const rightExpectedValue = Number(right.decision?.expectedValue?.netPct || 0);

      return (rightConfidence - leftConfidence)
        || (rightExpectedValue - leftExpectedValue);
    });

    for (const review of rankedReviews) {
      if (!review.risk.approved) continue;
      if (closedSymbols.has(review.symbol)) continue;

      const market = this.cache.markets.get(review.symbol);
      if (!market || !Number.isFinite(market.price) || market.price <= 0) continue;

      const tradeModes = ["strategy", "scalp"];

      for (const tradeMode of tradeModes) {
        const requestedSizeGbp = Number(review.decision.sizeGbp || this.config.paperExecution.fixedTradeSizeGbp || this.config.trade.defaultSizeGbp);
      const potCheck = this.canOpenPaperTradeInMode(tradeMode, requestedSizeGbp);

      if (!potCheck.approved) {
        this.events.append("paper.trade.rejected", {
          symbol: review.symbol,
          tradeMode,
          sizeGbp: requestedSizeGbp,
          reason: potCheck.reason
        });
        continue;
      }

      const executionDecision = {
        ...review.decision,
        symbol: review.decision.symbol || review.symbol,
        side: review.decision.side || review.side || "long",
        sizeGbp: requestedSizeGbp,
        potName: tradeMode,
        tradeMode,
        stopLossPct: Number.isFinite(review.decision.stopLossPct) ? review.decision.stopLossPct : 0.8,
        targetPct: Number.isFinite(review.decision.targetPct) ? review.decision.targetPct : 1.2,
        entryReason: `[${tradeMode}] ${review.decision.entryReason || review.scanner?.reason || "paper execution approved setup"}`
      };

      const trade = this.broker.open(executionDecision, market.price);
      opened.push(trade);
        this.events.append("paper.trade.opened", trade);
      }
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
      paperExecution: {
        scalpWinnerBasketExitEnabled:
          this.config.paperExecution.scalpWinnerBasketExitEnabled,
        scalpWinnerBasketTargetGbp:
          this.config.paperExecution.scalpWinnerBasketTargetGbp
      },
      paperPots: this.paperPotSummary(),
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
