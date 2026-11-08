// "word:<text>" resolves to the first occurrence; validate warns when an
// anchor names a common word the narration repeats and gives no #n.
import assert from "node:assert/strict";
import test from "node:test";
import { ambiguousWordAnchors, resolveAnchor } from "@launchclip/core/story.mjs";

const words = ["It", "can", "edit", "it", "fast", "and", "the", "tool", "fits", "the", "tool"].map((text, i) => ({ text, start: i * 0.5, end: i * 0.5 + 0.4 }));

test("word anchors: an un-numbered anchor on a repeated common word is named, a numbered or rare one is not", () => {
  assert.equal(resolveAnchor("word:it", { words }), 0, "the first occurrence");
  assert.equal(resolveAnchor("word:it#2", { words }), 1.5);
  const story = { scenes: [{ id: "s1", start: "word:it", end: "word:fits", params: { elements: [{ at: "word:the+0.1", flashAt: ["word:it#2", "word:tool", "word:edit"] }] } }] };
  assert.deepEqual(ambiguousWordAnchors(story, words), [
    { path: "scenes[0].start", anchor: "word:it", word: "it", count: 2 },
    { path: "scenes[0].params.elements[0].at", anchor: "word:the+0.1", word: "the", count: 2 }
  ]);
  assert.deepEqual(ambiguousWordAnchors(story, []), [], "no narration, nothing to check");
});
