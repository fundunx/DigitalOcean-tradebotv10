const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v8.js";
const backup = `/var/www/apexquant-v6/backups/v8-server-before-8-1-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace('const APP_VERSION = "8.0.0";', 'const APP_VERSION = "8.1.0";');

// Add order book storage
code = code.replace(
`    prices: {},
    candles: {},`,
`    prices: {},
    orderBooks: {},
    candles: {},`
);

// Add bookTicker websocket instead of ticker only
code = code.replace(
`const streams = activePairs().map(p => \`\${p.toLowerCase()}@ticker\`).join("/");`,
`const streams = activePairs().flatMap(p => [
    \`\${p.toLowerCase()}@ticker\`,
    \`\${p.toLowerCase()}@bookTicker\`
  ]).join("/");`
);

// Replace websocket message handling to process bid/ask
code = code.replace(
`      const symbol = d.s;
      const price = Number(d.c);
      const volume = Number(d.q || d.v || 0);
      if (!symbol || !price) return;

      state.prices[symbol] = { symbol, price, volume, time: Date.now() };
      updateCandles(symbol, price, volume);`,
`      const symbol = d.s;
      if (!symbol) return;

      // Book ticker gives live bid/ask spread.
      if (d.b && d.a) {
        const bid = Number(d.b);
        const ask = Number(d.a);
        const mid = (bid + ask) / 2;
        const spreadPercent = mid > 0 ? ((ask - bid) / mid) * 100 : 999;

        state.orderBooks[symbol] = {
          symbol,
          bid,
          ask,
          mid,
          spreadPercent,
          time: Date.now()
        };
        return;
      }

      const price = Number(d.c);
      const volume = Number(d.q || d.v || 0);
      if (!price) return;

      state.prices[symbol] = { symbol, price, volume, time: Date.now() };
      updateCandles(symbol, price, volume);`
);

// Add order book helper before brains
const helper = `

/*
==================================================
ORDER BOOK / BID ASK HELPERS
==================================================
*/

function orderBook(symbol) {
  return state.orderBooks?.[symbol] || null;
}

function spreadOk(symbol, maxSpreadPercent = 0.12) {
  const ob = orderBook(symbol);
  if (!ob) return { ok: false, reason: "No bid/ask yet", spreadPercent: 999 };

  if (ob.spreadPercent > maxSpreadPercent) {
    return {
      ok: false,
      reason: "Spread too wide " + round2(ob.spreadPercent) + "%",
      spreadPercent: ob.spreadPercent
    };
  }

  return {
    ok: true,
    reason: "Spread ok " + round2(ob.spreadPercent) + "%",
    spreadPercent: ob.spreadPercent
  };
}

function executionPrice(symbol, side) {
  const ob = orderBook(symbol);
  if (!ob) return state.prices[symbol]?.price || null;

  // LONG buys at ask. SHORT enters at bid.
  return side === "LONG" ? ob.ask : ob.bid;
}

function btcMasterRegime() {
  const m5 = candleMomentum("BTCUSDT", "5m", 3);
  const m15 = candleMomentum("BTCUSDT", "15m", 3);
  const m1 = candleMomentum("BTCUSDT", "1m", 5);

  if (m5 > 0.12 && m15 > 0) return "BULLISH";
  if (m5 < -0.12 && m15 < 0) return "BEARISH";
  if (Math.abs(m5) < 0.05 && Math.abs(m1) < 0.05) return "CHOP";
  return "MIXED";
}

function strategyScore(symbol) {
  const p = state.prices[symbol];
  if (!p) return { signal: "HOLD", score: 0, notes: ["no price"] };

  const price = p.price;
  const sr5 = candleSR(symbol, "5m", 30);
  const sr15 = candleSR(symbol, "15m", 20);

  const m1 = candleMomentum(symbol, "1m", 5);
  const m5 = candleMomentum(symbol, "5m", 3);
  const m15 = candleMomentum(symbol, "15m", 3);
  const vol5 = candleVolatility(symbol, "5m", 20);

  const btc = btcMasterRegime();
  const sp = spreadOk(symbol, 0.12);

  let long = 0;
  let short = 0;
  const notes = [];

  // Candle trend alignment
  if (m5 > 0.08) { long += 15; notes.push("5m trend up"); }
  if (m15 > 0.04) { long += 18; notes.push("15m trend up"); }
  if (m1 > 0.03) { long += 8; notes.push("1m supports long"); }

  if (m5 < -0.08) { short += 15; notes.push("5m trend down"); }
  if (m15 < -0.04) { short += 18; notes.push("15m trend down"); }
  if (m1 < -0.03) { short += 8; notes.push("1m supports short"); }

  // Support/resistance context
  if (sr5.support && price <= sr5.support * 1.008) {
    long += 15;
    notes.push("near 5m support");
  }

  if (sr5.resistance && price >= sr5.resistance * 0.992) {
    short += 15;
    notes.push("near 5m resistance");
  }

  if (sr15.support && price <= sr15.support * 1.012) {
    long += 10;
    notes.push("near 15m support");
  }

  if (sr15.resistance && price >= sr15.resistance * 0.988) {
    short += 10;
    notes.push("near 15m resistance");
  }

  // Breakout / breakdown
  if (sr5.resistance && price > sr5.resistance) {
    long += 18;
    notes.push("breakout above 5m resistance");
  }

  if (sr5.support && price < sr5.support) {
    short += 18;
    notes.push("breakdown below 5m support");
  }

  // BTC regime filter
  if (btc === "BULLISH") {
    long += 12;
    short -= 8;
    notes.push("BTC master bullish");
  }

  if (btc === "BEARISH") {
    short += 12;
    long -= 8;
    notes.push("BTC master bearish");
  }

  if (btc === "CHOP") {
    long -= 12;
    short -= 12;
    notes.push("BTC chop - lower conviction");
  }

  // Volatility must be enough to justify strategy trade.
  if (vol5 < 0.03) {
    long -= 8;
    short -= 8;
    notes.push("low 5m volatility");
  }

  // Spread penalty
  if (!sp.ok) {
    long -= 20;
    short -= 20;
    notes.push(sp.reason);
  } else {
    long += 5;
    short += 5;
    notes.push(sp.reason);
  }

  const signal = long >= short ? "LONG" : "SHORT";
  const score = Math.max(long, short);

  return {
    signal,
    score,
    longScore: long,
    shortScore: short,
    confidence: Math.max(0, Math.min(95, Math.round(score))),
    notes,
    btc,
    spreadPercent: sp.spreadPercent,
    support: sr5.support,
    resistance: sr5.resistance,
    m1,
    m5,
    m15,
    vol5
  };
}
`;

if (!code.includes("ORDER BOOK / BID ASK HELPERS")) {
  code = code.replace("/*\n==================================================\nSCALP + STRATEGY BRAINS", helper + "\n/*\n==================================================\nSCALP + STRATEGY BRAINS");
}

// Replace evaluateStrategy
const start = code.indexOf("function evaluateStrategy(symbol) {");
const end = code.indexOf("\n}\n\n/*\n==================================================\nRISK + TRADE ENGINE", start);

if (start === -1 || end === -1) {
  console.error("Could not find evaluateStrategy");
  process.exit(1);
}

const replacement = `function evaluateStrategy(symbol) {
  const p = state.prices[symbol];
  if (!p) return review(symbol, "strategy", "WAIT", "No price yet", 0);

  const s = strategyScore(symbol);
  const ex = expectedNet(symbol, "strategy");

  let signal = s.signal;
  let confidence = s.confidence;
  let reason = "V8.1 strategy " + signal + ": " + s.notes.join(", ");

  if (!state.settings.engines.strategyEnabled) {
    signal = "HOLD";
    confidence = 0;
    reason = "Strategy disabled";
  }

  // Do not allow weak generic LONG/SHORT spam.
  if (s.score < 70) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = "Strategy score too low " + s.score + ": " + s.notes.join(", ");
  }

  // Hard BTC master filter.
  if (s.btc === "BULLISH" && signal === "SHORT") {
    signal = "REJECT";
    confidence = 35;
    reason = "Short blocked because BTC master regime is bullish";
  }

  if (s.btc === "BEARISH" && signal === "LONG") {
    signal = "REJECT";
    confidence = 35;
    reason = "Long blocked because BTC master regime is bearish";
  }

  if (s.btc === "CHOP") {
    signal = "HOLD";
    confidence = Math.min(confidence, 55);
    reason = "Holding because BTC master regime is choppy";
  }

  const data = review(symbol, "strategy", signal, reason, confidence, {
    price: p.price,
    strategy: "V8.1 Candle Strategy + Bid/Ask",
    expectedNetGbp: ex,
    support: s.support,
    resistance: s.resistance,
    btcRegime: s.btc,
    spreadPercent: round2(s.spreadPercent),
    strategyScore: s.score,
    longScore: s.longScore,
    shortScore: s.shortScore,
    momentum1m: round2(s.m1),
    momentum5m: round2(s.m5),
    momentum15m: round2(s.m15),
    volatility5m: round2(s.vol5)
  });

  const risk = canOpenTrade("strategy", data);
  data.canBuy = risk.ok;
  data.whyNotBuying = risk.reason;
  return data;
}`;

code = code.slice(0, start) + replacement + code.slice(end + 3);

// Use bid/ask execution price when opening
code = code.replace(
`  const price = state.prices[r.symbol]?.price;
  if (!price) return null;`,
`  const price = executionPrice(r.symbol, r.signal);
  if (!price) return null;`
);

// Expose orderBooks
code = code.replace(
`    candles: state.candles,
    prices: state.prices`,
`    candles: state.candles,
    orderBooks: state.orderBooks,
    prices: state.prices`
);

fs.writeFileSync(file, code);

console.log("V8.1 strategy + order book patch applied.");
console.log("Backup created:", backup);
