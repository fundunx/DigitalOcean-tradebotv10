const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7/server-v7-before-7-0-4-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(
  'const APP_VERSION = "7.0.3";',
  'const APP_VERSION = "7.0.4";'
);

const start = code.indexOf("function estimateExpectedNetProfitGbp(symbol, sizeGbp, pot) {");
const end = code.indexOf("\n}\n\n// ==================================================\n// SECTION 15: RISK ENGINE", start);

if (start === -1 || end === -1) {
  console.error("Could not find estimateExpectedNetProfitGbp");
  process.exit(1);
}

const replacement = `function estimateExpectedNetProfitGbp(symbol, sizeGbp, pot) {
  const vol = volatilityPercent(symbol, 30);
  const mom3 = Math.abs(momentumPercent(symbol, 3));
  const mom5 = Math.abs(momentumPercent(symbol, 5));
  const mom20 = Math.abs(momentumPercent(symbol, 20));

  let expectedMovePercent;

  if (pot === "scalp") {
    // V7.0.4:
    // Use live micro-movement + volatility.
    // This stops expected net being stuck at £3.
    expectedMovePercent = Math.max(
      0.25,
      (vol * 2.2) +
      (mom3 * 1.8) +
      (mom5 * 1.4) +
      (mom20 * 0.5)
    );
  } else {
    expectedMovePercent = Math.max(0.6, vol * 1.5);
  }

  const expected = sizeGbp * (expectedMovePercent / 100) - estimateFeesGbp(1);

  return round2(expected);
}`;

code = code.slice(0, start) + replacement + code.slice(end + 3);

fs.writeFileSync(file, code);

console.log("V7.0.4 patch applied.");
console.log("Backup created:");
console.log(backup);
