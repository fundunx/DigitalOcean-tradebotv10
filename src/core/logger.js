function log(level, message, data = {}) {
  console.log(JSON.stringify({ level, message, data, at: new Date().toISOString() }));
}

module.exports = { log };
