const fs = require("fs");
const path = require("path");

class DecisionJournal {
  constructor({ dataDir = "data", fileName = "decision-reviews.jsonl" } = {}) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, fileName);
  }

  appendBatch({ reviews, context = {} }) {
    if (!Array.isArray(reviews) || reviews.length === 0) return [];

    fs.mkdirSync(this.dataDir, { recursive: true });

    const at = new Date().toISOString();
    const entries = reviews.map((review) => ({
      type: "decision.review",
      at,
      context,
      review
    }));

    fs.appendFileSync(
      this.filePath,
      entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n"
    );

    return entries;
  }

  recent(limit = 50) {
    if (!fs.existsSync(this.filePath)) return [];

    const lines = fs.readFileSync(this.filePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit);

    return lines.map((line) => JSON.parse(line));
  }
}

module.exports = { DecisionJournal };
