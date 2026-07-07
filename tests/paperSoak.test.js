const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

test("paper soak script runs without requiring fake startup trades", () => {
  const output = execFileSync("node", ["scripts/paper-soak.js"], {
    encoding: "utf8"
  });

  const data = JSON.parse(output);

  assert.equal(data.ok, true);
  assert.ok(Number.isFinite(data.closedTrades));
  assert.ok(Number.isFinite(data.openTrades));
  assert.ok(Number.isFinite(data.realizedPnlGbp));
});
