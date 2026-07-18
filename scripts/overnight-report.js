#!/usr/bin/env node

const fs = require('node:fs');

const file = process.argv[2] || 'data/overnight-watch.jsonl';

function money(n) {
  n = Number(n) || 0;
  const sign = n > 0 ? '+' : n < 0 ? '-' : '';
  return `${sign}£${Math.abs(n).toFixed(2)}`;
}

function n(v) {
  return Number(v) || 0;
}

if (!fs.existsSync(file)) {
  console.error(`Missing file: ${file}`);
  process.exit(1);
}

const rows = fs.readFileSync(file, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => {
    try { return JSON.parse(line); } catch { return null; }
  })
  .filter(Boolean);

const good = rows.filter(r => r.ok && r.totals);

console.log('');
console.log('APEXQUANT OVERNIGHT REPORT');
console.log('==========================');
console.log('File:', file);
console.log('Rows:', rows.length);
console.log('Good rows:', good.length);
console.log('Bad rows:', rows.length - good.length);
console.log('');

if (!good.length) {
  console.log('No valid watcher rows found.');
  process.exit(0);
}

const first = good[0];
const last = good[good.length - 1];

console.log('PERIOD');
console.log('------');
console.log('Start:', first.ts);
console.log('End:  ', last.ts);
console.log('');

console.log('START');
console.log('-----');
console.log('Open trades: ', first.totals.openTrades);
console.log('Closed trades:', first.totals.closedTrades);
console.log('Exposure:     ', money(first.totals.exposure));
console.log('Realized:     ', money(first.totals.realizedPnl));
console.log('Unrealized:   ', money(first.totals.unrealizedPnl));
console.log('Total PnL:    ', money(first.totals.totalPnl));
console.log('');

console.log('END');
console.log('---');
console.log('Open trades: ', last.totals.openTrades);
console.log('Closed trades:', last.totals.closedTrades);
console.log('Exposure:     ', money(last.totals.exposure));
console.log('Realized:     ', money(last.totals.realizedPnl));
console.log('Unrealized:   ', money(last.totals.unrealizedPnl));
console.log('Total PnL:    ', money(last.totals.totalPnl));
console.log('');

console.log('CHANGE');
console.log('------');
console.log('Open trades: ', n(last.totals.openTrades) - n(first.totals.openTrades));
console.log('Closed trades:', n(last.totals.closedTrades) - n(first.totals.closedTrades));
console.log('Exposure:     ', money(n(last.totals.exposure) - n(first.totals.exposure)));
console.log('Realized:     ', money(n(last.totals.realizedPnl) - n(first.totals.realizedPnl)));
console.log('Unrealized:   ', money(n(last.totals.unrealizedPnl) - n(first.totals.unrealizedPnl)));
console.log('Total PnL:    ', money(n(last.totals.totalPnl) - n(first.totals.totalPnl)));
console.log('');

console.log('LATEST MODES');
console.log('------------');

for (const mode of last.modes || []) {
  console.log(
    `${String(mode.mode).toUpperCase().padEnd(10)} ` +
    `open ${String(mode.openTrades).padStart(3)} ` +
    `closed ${String(mode.closedTrades).padStart(4)} ` +
    `exposure ${money(mode.openExposure).padStart(12)} ` +
    `realized ${money(mode.realizedPnl).padStart(12)} ` +
    `unreal ${money(mode.unrealizedPnl).padStart(12)} ` +
    `total ${money(mode.totalPnl).padStart(12)}`
  );
}

console.log('');
