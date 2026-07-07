class WhatIf {
  constructor() {
    this.records = [];
  }

  record(event) {
    const record = { ...event, recordedAt: new Date().toISOString() };
    this.records.push(record);
    return record;
  }

  recent(limit = 20) {
    return this.records.slice(-limit);
  }
}

module.exports = { WhatIf };
