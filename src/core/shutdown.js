function setupShutdown(tasks = []) {
  let done = false;

  async function shutdown() {
    if (done) return;
    done = true;
    for (const task of tasks) {
      if (typeof task === "function") await task();
    }
    process.exit(0);
  }

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return shutdown;
}

module.exports = { setupShutdown };
