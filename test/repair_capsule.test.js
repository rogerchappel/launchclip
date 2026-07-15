import assert from "node:assert/strict";
import test from "node:test";
import { buildRepairSourceCapsule, collectRepairSelectors, REPAIR_CAPSULE_VERSION } from "../src/repair_capsule.js";

test("extracts exact selector-centred source for a large local repair", () => {
  const filler = ".unused{color:#111}".repeat(1_500);
  const relevant = `<style>#shot-proof{opacity:0;transform:translateY(24px)}</style><div id="shot-proof">Proof</div><script>gsap.set("#shot-proof",{opacity:0});timeline.to("#shot-proof",{opacity:1});</script>`;
  const prior = bundle(`<template>${filler}${relevant}${filler}</template>`);
  const capsule = buildRepairSourceCapsule(prior, [{ instruction: "Fix motion_frozen at #shot-proof", selector: "#shot-proof" }], [], { htmlChars: 4_000 });
  const html = capsule.sources.filter((entry) => entry.target === "html");
  assert.equal(capsule.version, REPAIR_CAPSULE_VERSION);
  assert.deepEqual(capsule.selectors, ["#shot-proof"]);
  assert.ok(html.every((entry) => entry.scope === "selector"));
  assert.ok(html.reduce((total, entry) => total + entry.source.length, 0) <= 4_000);
  assert.ok(html.some((entry) => entry.source.includes('id="shot-proof"')));
  assert.ok(html.some((entry) => entry.source.includes('timeline.to("#shot-proof"')));
  assert.ok(html.every((entry) => prior.html.includes(entry.source)), "every excerpt must be copied verbatim from the complete target");
  assert.ok(html.reduce((total, entry) => total + entry.source.length, 0) < prior.html.length / 4);
});

test("keeps short repair targets complete", () => {
  const prior = bundle('<div id="shot-proof">Proof</div>');
  const capsule = buildRepairSourceCapsule(prior, [{ selector: "#shot-proof" }]);
  const html = capsule.sources.find((entry) => entry.target === "html");
  const motion = capsule.sources.find((entry) => entry.target === "motion");
  assert.equal(html.scope, "complete");
  assert.equal(html.source, prior.html);
  assert.equal(motion.scope, "complete");
  assert.equal(motion.source, JSON.stringify(prior.motion, null, 2));
});

test("discovers selectors in structured findings and retry errors", () => {
  const selectors = collectRepairSelectors([
    { instruction: "Resolve overlap at #shot-card, then inspect .proof-row." },
    { repair_targets: [{ selector: "#shot-copy" }] }
  ], ["Candidate failed at #shot-card"]);
  assert.deepEqual(selectors, ["#shot-card", ".proof-row", "#shot-copy"]);
});

function bundle(html) {
  return {
    html,
    motion: {
      assertions: [{ selector: "#shot-proof", appears_by_seconds: 1, must_remain_live: true }],
      events: [{ event_id: "proof-lock", selector: "#shot-proof", at_seconds: 1 }]
    },
    root_media_requests: [],
    evidence_ids: ["ev-1"],
    visible_copy: ["Proof"],
    preserve: ["Exact copy"]
  };
}
