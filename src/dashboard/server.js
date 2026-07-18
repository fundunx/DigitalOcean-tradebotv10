const fs = require("fs");
const http = require("http");
const path = require("path");
const { readiness } = require("../core/readiness");

function send(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function createDashboard({ engine, feed, config }) {
  return http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/dashboard" || req.url === "/dashboard.html") {
      const dashboardPath = path.join(process.cwd(), "dashboard.html");

      if (!fs.existsSync(dashboardPath)) {
        return send(res, 404, { error: "dashboard.html not found" });
      }

      return sendHtml(res, 200, fs.readFileSync(dashboardPath, "utf8"));
    }

    if (req.url === "/health") {
      return send(res, 200, { ok: true });
    }

    if (req.url === "/api/health") {
      return send(res, 200, { ok: true });
    }

    if (req.url === "/api/summary") {
      return send(res, 200, engine.summary(feed.health(config.staleAfterMs)));
    }

    if (req.url === "/api/state") {
      return send(res, 200, engine.state(feed.health(config.staleAfterMs)));
    }

    if (req.url === "/api/decisions/review") {
      return send(res, 200, {
        mode: config.mode,
        liveTradingLocked: config.liveTradingLocked,
        paperOnly: true,
        opensTrades: false,
        persists: false,
        reviewedAt: new Date().toISOString(),
        reviews: engine.reviewDecisions()
      });
    }

    if (req.url === "/api/decisions/capture") {
      return send(res, 200, {
        mode: config.mode,
        liveTradingLocked: config.liveTradingLocked,
        paperOnly: true,
        opensTrades: false,
        persists: true,
        reviewedAt: new Date().toISOString(),
        reviews: engine.reviewDecisions({
          persist: true,
          context: {
            source: "api.decisions.capture",
            mode: config.mode,
            paperOnly: true,
            opensTrades: false
          }
        })
      });
    }

    if (req.url === "/api/paper/cycle") {
      return send(res, 200, {
        mode: config.mode,
        liveTradingLocked: config.liveTradingLocked,
        paperOnly: true,
        result: engine.runPaperExecutionCycle({ source: "api.paper.cycle" })
      });
    }

    if (req.url === "/api/decisions/journal") {
      return send(res, 200, {
        mode: config.mode,
        paperOnly: true,
        entries: engine.recentDecisionReviews(50)
      });
    }

    if (req.url === "/api/readiness") {
      return send(res, 200, readiness({ config, feedHealth: feed.health(config.staleAfterMs) }));
    }

    if (req.url === "/api/settings/risk") {
      return send(res, 200, config.risk);
    }

    return send(res, 404, { error: "not found" });
  });
}

module.exports = { createDashboard };
