// The environment every HyperFrames CLI call runs with (renders, snapshots,
// checks). Import-free, so src/scripts/build-evidence.mjs and the skills'
// copies of it can use it too.
//
// HyperFrames gives a snapshot's page load PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS
// (10 s by default) to reach DOMContentLoaded. A long composition (an
// 8.5-minute explainer bundles to several MB of HTML) takes longer than that,
// so snapshots, and the evidence and gates built on them, failed with
// "Navigation timeout of 10000 ms exceeded" although the render worked.
// LaunchClip gives the page 3 minutes unless the caller set the variable.
export const HYPERFRAMES_NAVIGATION_TIMEOUT_MS = 3 * 60 * 1000;

// HyperFrames kills an ffmpeg frame extraction after FFMPEG_PROCESS_TIMEOUT_MS
// (5 minutes by default) and then renders that video as black, with no error.
// A long 4K recording takes longer than that to decode, so renders give it
// 30 minutes unless the caller set the variable.
export const HYPERFRAMES_FFMPEG_TIMEOUT_MS = 30 * 60 * 1000;

/** env with LaunchClip's HyperFrames timeouts filled in where the caller left them unset. */
export function hyperframesEnv(env = process.env) {
  const out = { ...env };
  if (!out.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS) out.PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS = String(HYPERFRAMES_NAVIGATION_TIMEOUT_MS);
  if (!out.FFMPEG_PROCESS_TIMEOUT_MS) out.FFMPEG_PROCESS_TIMEOUT_MS = String(HYPERFRAMES_FFMPEG_TIMEOUT_MS);
  return out;
}
