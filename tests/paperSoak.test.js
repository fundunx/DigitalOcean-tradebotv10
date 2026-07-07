const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("paper soak script runs", () => {
  const result = spawnSync(process.execPath, ["scripts/paper-soak.js"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  const data = JSON.parse(result.stdout);
  assert.equal(data.ok, true);
  assert.ok(data.closedTrades > 0);
});
