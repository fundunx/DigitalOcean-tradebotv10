class LearningAdvisor {
  advise(records = []) {
    if (records.length < 10) {
      return { action: "collect_more_data", reason: "not enough evidence" };
    }
    return { action: "review_strategy", reason: "enough paper-trade evidence collected" };
  }
}

module.exports = { LearningAdvisor };
