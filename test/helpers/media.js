// Media tests: the ones that drive FFmpeg, render with Remotion or HyperFrames,
// or record with Playwright. They take most of the suite's wall-clock time, so
// the default `npm test` skips them; `npm run test:media` runs every file that
// imports this helper with LAUNCHCLIP_MEDIA_TESTS=1, and so does the "Media
// tests" CI job. The tests keep their own availability checks: a missing FFmpeg
// or Chromium still skips them in media mode.

export const MEDIA_TESTS = process.env.LAUNCHCLIP_MEDIA_TESTS === "1";
export const MEDIA_SKIP = "media test: run with npm run test:media (LAUNCHCLIP_MEDIA_TESTS=1)";

/** A node:test skip value: the media-mode reason first, then the test's own reason (a string, or false to run). */
export function mediaSkip(reason = false) {
  return MEDIA_TESTS ? reason : MEDIA_SKIP;
}
