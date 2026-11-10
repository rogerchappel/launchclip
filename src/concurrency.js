// Running independent work side by side, with results in the order asked.
//
//   mapLimit(items, limit, fn)  → fn's results in item order, at most `limit` running
//   createLimiter(limit)        → run(task): a FIFO pool for tasks started at different times
//
// Both keep outputs independent of which task finishes first: results come
// back by position, and the error thrown is the earliest item's, as a loop
// over the items one at a time would throw.

/** fn(item, index) over items, at most `limit` at once. → results in item order. */
export async function mapLimit(items, limit, fn) {
  const list = Array.from(items ?? []);
  const results = new Array(list.length);
  const failures = [];
  let next = 0;
  const workers = Math.max(1, Math.min(Math.floor(Number(limit)) || 1, list.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    // After a failure nothing new starts; what is running finishes.
    while (next < list.length && !failures.length) {
      const index = next;
      next += 1;
      try { results[index] = await fn(list[index], index); } catch (error) { failures.push({ index, error }); }
    }
  }));
  if (failures.length) throw failures.sort((a, b) => a.index - b.index)[0].error;
  return results;
}

/** A pool: run(task) starts tasks in the order they were handed in, at most `limit` at once. */
export function createLimiter(limit) {
  const size = Math.max(1, Math.floor(Number(limit)) || 1);
  const waiting = [];
  let active = 0;
  const pump = () => {
    while (active < size && waiting.length) {
      active += 1;
      waiting.shift()();
    }
  };
  const run = (task) => new Promise((resolve, reject) => {
    waiting.push(() => {
      Promise.resolve().then(task).then(resolve, reject).finally(() => { active -= 1; pump(); });
    });
    pump();
  });
  run.limit = size;
  return run;
}
