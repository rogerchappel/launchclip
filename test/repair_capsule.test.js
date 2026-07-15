import assert from "node:assert/strict";
import test from "node:test";
import { buildRepairContextCapsule, buildRepairSourceCapsule, collectDiagnosticTerms, collectRepairSelectors, REPAIR_CAPSULE_VERSION } from "../src/repair_capsule.js";

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

test("gives a contrast repair only the exact style region", () => {
  const filler = "<section class='unused'>Unused</section>".repeat(600);
  const prior = bundle(`<template><style>#shot-proof{color:#777;background:#fff}</style>${filler}<div id="shot-proof">Proof</div></template>`);
  const capsule = buildRepairSourceCapsule(prior, [{ repair_targets: [{ code: "contrast_aa_failure", selector: "#shot-proof", message: "Contrast is 2:1" }] }], [], { htmlChars: 3_000 });
  const html = capsule.sources.filter((entry) => entry.target === "html");
  assert.deepEqual(capsule.repair_codes, ["contrast_aa_failure"]);
  assert.ok(html.length > 0);
  assert.ok(html.every((entry) => entry.role === "style"));
  assert.ok(html.some((entry) => entry.source.includes("#shot-proof{color:#777")));
  assert.ok(html.every((entry) => !entry.source.includes('<div id="shot-proof"')));
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
    { repair_targets: [{ selector: "#shot-copy" }, { selector: "div.frame-title.emphasis" }] }
  ], ["Candidate failed at #shot-card"]);
  assert.deepEqual(selectors, ["#shot-card", ".proof-row", "#shot-copy", ".frame-title", ".emphasis"]);
});

test("centres runtime repair excerpts on APIs named by diagnostics", () => {
  const filler = "const noop=()=>{};".repeat(1_000);
  const runtime = "const panel=root.querySelector('.panel');panel.querySelector('.label').textContent='Ready';";
  const prior = bundle(`<script>${filler}${runtime}${filler}</script>`);
  const findings = [{ repair_targets: [{ code: "console_error", message: "Cannot read properties of null (reading 'querySelector')", selector: "[data-composition-id]" }] }];
  const capsule = buildRepairSourceCapsule(prior, findings, [], { htmlChars: 3_000 });
  assert.deepEqual(collectDiagnosticTerms(findings), ["querySelector"]);
  assert.deepEqual(capsule.diagnostic_terms, ["querySelector"]);
  const html = capsule.sources.filter((entry) => entry.target === "html");
  assert.ok(html.some((entry) => entry.source.includes(runtime)));
  assert.ok(html.every((entry) => entry.role === "script"));
});

test("compacts a local repair context without dropping visual identities or event timing", () => {
  const capsule = buildRepairContextCapsule({
    design: { concept: "Proof", palette_roles: { ink: "#111" }, style_dna: { forbidden_motifs: ["large", "cloud-only", "payload"] } }
  }, {
    id: "shot-1", start_seconds: 0, end_seconds: 5, purpose: "Show proof", voiceover: "Long narration is already frozen elsewhere.",
    on_screen_text: ["Proof"], transition_out: { description: "Not needed for a local selector repair" },
    visual: {
      description: "A proof node locks into place.", internal_reveals: [{ at_seconds: 2, action: "Redundant with events" }],
      objects: [{ id: "proof-node", kind: "diagram-node", meaning: "Evidence", layer: "foreground", lifecycle: "enter", extra: "omit" }],
      events: [{ id: "proof-lock", at_seconds: 2, target_ids: ["proof-node"], action: "Lock", motion_verb: "settle", visible_change: "transform", easing_intent: "omit" }]
    }
  });
  assert.equal(capsule.global_design.concept, "Proof");
  assert.equal(capsule.global_design.style_dna, undefined);
  assert.equal(capsule.shot.voiceover, undefined);
  assert.equal(capsule.shot.visual.internal_reveals, undefined);
  assert.deepEqual(capsule.shot.visual.objects, [{ id: "proof-node", kind: "diagram-node", meaning: "Evidence", layer: "foreground", lifecycle: "enter" }]);
  assert.deepEqual(capsule.shot.visual.events[0].target_ids, ["proof-node"]);
  assert.equal(capsule.shot.visual.events[0].at_seconds, 2);
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
