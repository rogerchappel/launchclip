// Promise rejections that surface outside the awaited chain while a stage
// runs, turned into that stage's failure instead of a process crash.
//
// Node crashes on an 'unhandledRejection' that has no listener, even when the
// promise gets a handler a moment later. Remotion's browser download does
// exactly that: downloadBrowser() returns Promise.reject(err) from a try
// whose finally awaits file I/O, so the rejection is unhandled for a few
// event-loop turns before it reaches the awaiting caller. Offline (no
// browser in node_modules/.remotion and no network), `launchclip make` died
// with "getaddrinfo EAI_AGAIN remotion.media" and wrote no report.
//
// While guarded work runs, a rejection that is handled late is left to reach
// its awaiting caller (the stage runner catches it as usual). One that stays
// unhandled for `graceMs` fails the guarded work with its own message.
const scopes = new Set();

function onUnhandled(reason, promise) {
  for (const scope of scopes) scope.unhandled(reason, promise);
}

function onHandled(promise) {
  for (const scope of scopes) scope.handled(promise);
}

/**
 * Run fn() with unhandled promise rejections caught. Resolves or rejects as
 * fn does; rejects with the reason of a rejection that nothing handled within
 * graceMs while fn ran (or by the time it settled).
 */
export async function guardRejections(fn, { graceMs = 5000 } = {}) {
  const pending = new Map();
  let fail;
  const escaped = new Promise((_, reject) => { fail = reject; });
  escaped.catch(() => {});
  const scope = {
    unhandled(reason, promise) {
      const timer = setTimeout(() => {
        pending.delete(promise);
        fail(escapedError(reason));
      }, graceMs);
      timer.unref?.();
      pending.set(promise, { reason, timer });
    },
    handled(promise) {
      const entry = pending.get(promise);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(promise);
    }
  };
  if (!scopes.size) {
    process.on("unhandledRejection", onUnhandled);
    process.on("rejectionHandled", onHandled);
  }
  scopes.add(scope);
  try {
    const result = await Promise.race([Promise.resolve().then(fn), escaped]);
    // rejectionHandled is emitted a turn after the late handler attaches.
    await new Promise((resolve) => setImmediate(resolve));
    const left = [...pending.values()][0];
    if (left) throw escapedError(left.reason);
    return result;
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timer);
    scopes.delete(scope);
    if (!scopes.size) {
      process.off("unhandledRejection", onUnhandled);
      process.off("rejectionHandled", onHandled);
    }
  }
}

function escapedError(reason) {
  if (reason instanceof Error) return reason;
  return new Error(`unhandled promise rejection: ${String(reason)}`);
}
