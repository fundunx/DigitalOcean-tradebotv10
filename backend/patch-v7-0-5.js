const fs = require("fs");
const path = require("path");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7/server-v7-before-7-0-5-${Date.now()}.js`;

fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(
  'const APP_VERSION = "7.0.4";',
  'const APP_VERSION = "7.0.5";'
);

// Balanced profile should test, not freeze
code = code.replace(
`  return {
    minExpectedNetGbp: 6,
    minConfidence: 82,
    requiredConfirmations: 3,
    label: "BALANCED"
  };`,
`  return {
    minExpectedNetGbp: 6,
    minConfidence: 70,
    requiredConfirmations: 3,
    label: "BALANCED"
  };`
);

// Lower pattern score threshold
code = code.replace(
`  if (bestScore < 28) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = "No scalp entry yet. Pattern score " + bestScore + ". " + (notes.join(", ") || "No clear setup");
  }`,
`  if (bestScore < 22) {
    signal = "HOLD";
    confidence = Math.min(confidence, 60);
    reason = "No scalp entry yet. Pattern score " + bestScore + ". " + (notes.join(", ") || "No clear setup");
  }`
);

// Make strong expected-net setups easier to test
code = code.replace(
`  let reason = "Scalp " + signal + ": " + (notes.join(", ") || "watching") + "; " + learning.message;`,
`  if (expectedNet >= 10 && bestScore >= 22) {
    confidence = Math.max(confidence, 72);
  }

  if (expectedNet >= 15 && bestScore >= 22) {
    confidence = Math.max(confidence, 76);
  }

  let reason = "Scalp " + signal + ": " + (notes.join(", ") || "watching") + "; " + learning.message;`
);

fs.writeFileSync(file, code);

console.log("V7.0.5 patch applied.");
console.log("Backup created:");
console.log(backup);
