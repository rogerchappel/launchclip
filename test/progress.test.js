import assert from "node:assert/strict";
import test from "node:test";
import { parseProgressLine, progressLine } from "../src/progress.js";

test("a progress line round-trips, and any other line is not progress", () => {
  const event = { stage: "finish", step: "render", done: 3, total: 12 };
  assert.equal(progressLine(event), 'launchclip:progress {"stage":"finish","step":"render","done":3,"total":12}');
  assert.deepEqual(parseProgressLine(progressLine(event)), event);
  assert.equal(parseProgressLine("finish: voice, captions"), null);
  assert.equal(parseProgressLine("launchclip:progress not json"), null);
  assert.equal(parseProgressLine("launchclip:progress [1]"), null);
});
