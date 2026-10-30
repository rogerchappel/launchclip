// Machine-readable progress on stderr, beside the human notices: one line per
// event, `launchclip:progress {"stage":"finish","step":"render","done":3,"total":12}`.
// An app running `launchclip make` as a subprocess reads these to move its own
// progress bar and to log how far a run got when it is stopped.
export const PROGRESS_PREFIX = "launchclip:progress ";

/** One progress line for an event: {stage, step?, done?, total?}. */
export function progressLine(event) {
  return `${PROGRESS_PREFIX}${JSON.stringify(event)}`;
}

/** The event in a progress line, or null for any other line. */
export function parseProgressLine(line) {
  const text = String(line ?? "");
  if (!text.startsWith(PROGRESS_PREFIX)) return null;
  try {
    const event = JSON.parse(text.slice(PROGRESS_PREFIX.length));
    return event && typeof event === "object" && !Array.isArray(event) ? event : null;
  } catch {
    return null;
  }
}
