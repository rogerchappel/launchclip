// Unhandled-rejection fixtures. node:test listens for unhandled rejections
// itself (and fails the test), so asInTheCli() sets its listeners aside: as in
// the CLI, an unhandled rejection with no listener then crashes the process.
export async function asInTheCli(fn) {
  const saved = process.rawListeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  try {
    return await fn();
  } finally {
    for (const listener of saved) process.on("unhandledRejection", listener);
  }
}

// Remotion's downloadBrowser(): `return Promise.reject(err)` from a try whose
// finally awaits I/O. The rejection has no handler for a few event-loop
// turns, which crashes Node unless something listens for it.
export async function lateHandledRejection(message) {
  try {
    return Promise.reject(new Error(message));
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
