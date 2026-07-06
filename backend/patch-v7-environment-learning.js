const fs = require("fs");

const file = "/var/www/apexquant-v6/backend/server-v7.js";
const backup = `/var/www/apexquant-v6/backups/v7-environment-learning-${Date.now()}.js`;

fs.copyFileSync(file, backup);

let code = fs.readFileSync(file, "utf8");

code = code.replace(/const APP_VERSION = "[^"]+";/, 'const APP_VERSION = "7.1.1-environment-learning";');

const block = `
const https = require("https");

function httpsJson(url, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(null); }
      });
    });

    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function ensureEnvironmentState() {
  if (!state.environment) {
    state.environment = {
      updatedAt: null,
      fearGreed: null,
      btcRegime: null,
      btcMomentum: null,
      ethMomentum: null,
      macroRisk: "UNKNOWN",
      notes: []
    };
  }
}

function simpleMomentum(symbol, lookback = 20) {
  try {
    if (typeof momentumPercent === "function") return round2(momentumPercent(symbol, lookback));
  } catch {}
  return null;
}

async function updateEnvironmentSnapshot() {
  ensureEnvironmentState();

  const notes = [];

  let fearGreed = state.environment.fearGreed;

  const fg = await httpsJson("https://api.alternative.me/fng/?limit=1");

  if (fg && fg.data && fg.data[0]) {
    fearGreed = {
      value: Number(fg.data[0].value),
      label: fg.data[0].value_classification,
      source: "alternative.me"
    };
    notes.push("Fear & Greed updated");
  } else {
    notes.push("Fear & Greed unavailable");
  }

  const btcMom = simpleMomentum("BTCUSDT", 20);
  const ethMom = simpleMomentum("ETHUSDT", 20);

  let btcRegime = "UNKNOWN";

  if (btcMom !== null) {
    if (btcMom > 0.3) btcRegime = "BTC_BULLISH";
    else if (btcMom < -0.3) btcRegime = "BTC_BEARISH";
    else btcRegime = "BTC_CHOP";
  }

  let macroRisk = "NORMAL";

  if (fearGreed && fearGreed.value <= 25) macroRisk = "FEAR_RISK_OFF";
  if (fearGreed && fearGreed.value >= 75) macroRisk = "GREED_RISK_ON";
  if (btcRegime === "BTC_BEARISH") macroRisk = "BTC_RISK_OFF";

  state.environment = {
    updatedAt: new Date().toISOString(),
    fearGreed,
    btcRegime,
    btcMomentum: btcMom,
    ethMomentum: ethMom,
    macroRisk,
    notes
  };
}

function currentEnvironmentFingerprint() {
  ensureEnvironmentState();

  const fg = state.environment.fearGreed;

  return {
    time: new Date().toISOString(),
    hourUtc: new Date().getUTCHours(),
    dayOfWeekUtc: new Date().getUTCDay(),
    fearGreedValue: fg ? fg.value : null,
    fearGreedLabel: fg ? fg.label : "UNKNOWN",
    btcRegime: state.environment.btcRegime || "UNKNOWN",
    btcMomentum: state.environment.btcMomentum,
    ethMomentum: state.environment.ethMomentum,
    macroRisk: state.environment.macroRisk || "UNKNOWN"
  };
}
`;

if (!code.includes("function currentEnvironmentFingerprint()")) {
  code = code.replace("function ensureSetupLearning()", block + "\nfunction ensureSetupLearning()");
}

// Add environment to adaptive learning recent row
code = code.replace(
`exitReason: trade.reasonExit,`,
`exitReason: trade.reasonExit,
    environment: currentEnvironmentFingerprint(),`
);

// Expose environment in API
if (!code.includes("environment: state.environment")) {
  code = code.replace(
`setupLearning: state.setupLearning,`,
`setupLearning: state.setupLearning,
    environment: state.environment,`
  );
}

// Start updater
if (!code.includes("setInterval(updateEnvironmentSnapshot")) {
  code = code.replace(
`startFeed();`,
`startFeed();

ensureEnvironmentState();
updateEnvironmentSnapshot();
setInterval(updateEnvironmentSnapshot, 15 * 60 * 1000);`
  );
}

fs.writeFileSync(file, code);

console.log("Environment learning patch applied.");
console.log("Backup:", backup);
