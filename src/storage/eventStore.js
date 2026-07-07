class EventStore {
  constructor() {
    this.events = [];
  }

  append(type, payload) {
    const event = { type, payload, at: new Date().toISOString() };
    this.events.push(event);
    return event;
  }

  recent(limit = 50) {
    return this.events.slice(-limit);
  }
}

module.exports = { EventStore };
