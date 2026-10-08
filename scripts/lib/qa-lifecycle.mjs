// Bound both phases so a failed route cannot leave the QA runner waiting forever.
function bounded(label, timeoutMs) {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  const timer = setTimeout(() => reject(new Error(`${label}: timeout`)), timeoutMs);
  promise.then(() => clearTimeout(timer), () => clearTimeout(timer));
  return { promise, resolve, reject, dispose: () => clearTimeout(timer) };
}
export function delayedQaRoute(label, timeoutMs = 10000) {
  const committed = bounded(`${label}: commit`, timeoutMs);
  const finished = bounded(`${label}: response`, timeoutMs * 2);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  return {
    committed: committed.promise, finished: finished.promise, release,
    dispose() { release(); committed.dispose(); finished.dispose(); },
    async handle(route) {
      try {
        const response = await route.fetch({ timeout: timeoutMs });
        if (response.status() !== 200) throw new Error(`${label}: HTTP ${response.status()}`);
        committed.resolve();
        await gate;
        await route.fulfill({ response });
        finished.resolve();
      } catch (error) {
        committed.reject(error); finished.reject(error);
        try { await route.abort(); } catch { /* The browser may already be closed. */ }
      }
    },
  };
}
export async function closeQaFixture(page, server) {
  try { await page?.close(); }
  finally {
    await new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections?.(); // Only this fixture's own server/connections.
    });
  }
}
