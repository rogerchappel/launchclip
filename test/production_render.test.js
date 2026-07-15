import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProductionVerificationError, assertVerificationFresh, classifyCommandFailure, plannedTypographyErrors, renderDraftProduction, renderProduction, verifyProduction, verifySemanticArtifacts, verifyShotCompositions } from "../src/production_render.js";

test("runs lint, browser validation, transition-aware checks, and assembled snapshots", async () => {
  const workspace = await fixture();
  const commands = [];
  const run = async (command, args) => { commands.push([command, args]); return { stdout: args.includes("--json") ? '{"findings":[]}' : "snapshots written", stderr: "" }; };
  const result = await verifyProduction(workspace, { inspectSamples: 17, snapshotFrames: 9 }, { run });
  assert.equal(result.status, "ready");
  assert.ok(commands.every(([command, args]) => command === process.execPath && args[0].endsWith("hyperframes/dist/cli.js")));
  assert.deepEqual(commands.map((entry) => entry[1][1]), ["lint", "validate", "check", "snapshot"]);
  assert.ok(commands[2][1].includes("--at-transitions"));
  assert.ok(commands[3][1].includes("9"));
  assert.deepEqual((JSON.parse(await readFile(path.join(result.qa, "verification.json"), "utf8"))).failed, []);
});

test("runs each model-authored shot motion sidecar through an isolated native check", async () => {
  const workspace = await fixture();
  await addShotFixture(workspace);
  const commands = [];
  const result = await verifyProduction(workspace, { inspectSamples: 11 }, {
    run: async (command, args, options) => {
      commands.push({ command, args, options });
      return { stdout: args.includes("--json") ? JSON.stringify({ ok: true, motionSpec: args.at(-1).includes("shot-inspect") ? "index.motion.json" : null, issues: [] }) : "ok", stderr: "" };
    }
  });
  assert.equal(result.checks["inspect:shot-1"].ok, true);
  const shotCommand = commands.find((entry) => entry.args[1] === "check" && entry.args.at(-1).includes("shot-inspect"));
  assert.ok(shotCommand);
  assert.ok(shotCommand.args.includes("--at-transitions"));
  assert.equal(shotCommand.args[shotCommand.args.indexOf("--samples") + 1], "11");
  const directory = path.join(result.qa, "shot-inspect", "shot-1");
  assert.match(await readFile(path.join(directory, "index.html"), "utf8"), /data-composition-src="compositions\/shot\.html"/);
  assert.match(await readFile(path.join(directory, "index.html"), "utf8"), /gsap@3\.14\.2/);
  assert.match(await readFile(path.join(directory, "index.html"), "utf8"), /connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'/);
  assert.equal(await readFile(path.join(directory, "assets", "proof.png"), "utf8"), "proof-image");
  assert.equal(JSON.parse(await readFile(path.join(directory, "index.motion.json"), "utf8")).assertions[0].selector, "#proof");
});

test("waits for active shot inspectors before reporting a sibling setup failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-shot-drain-"));
  const project = path.join(root, "project");
  const compositions = path.join(project, "compositions");
  const qa = path.join(root, "qa");
  await Promise.all([mkdir(compositions, { recursive: true }), mkdir(qa, { recursive: true })]);
  await writeFile(path.join(compositions, "shot-2.html"), '<div data-composition-id="shot-2"></div>');
  await writeFile(path.join(compositions, "shot-2.motion.json"), JSON.stringify({ version: 1, duration: 5, assertions: [] }));
  let siblingSettled = false;
  const plan = {
    format: { width: 1080, height: 1920, language: "en" },
    shots: [
      { id: "shot-1", start_seconds: 0, end_seconds: 5 },
      { id: "shot-2", start_seconds: 5, end_seconds: 10 }
    ]
  };
  await assert.rejects(() => verifyShotCompositions(project, qa, plan, {
    concurrency: 2,
    run: async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      siblingSettled = true;
      return { stdout: "{}", stderr: "" };
    }
  }), { code: "ENOENT" });
  assert.equal(siblingSettled, true);
  assert.equal(JSON.parse(await readFile(path.join(qa, "shot-inspect", "shot-2", "inspect.json"), "utf8")).ok, true);
});

test("reuses a content-addressed verification receipt with intact reports and snapshots", async () => {
  const workspace = await fixture();
  const commands = [];
  const run = async (_command, args) => {
    commands.push(args[1]);
    if (args[1] === "snapshot") await writeFile(path.join(args[args.indexOf("--output") + 1], "frame-00.png"), "snapshot");
    return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" };
  };
  const adapters = { run, verifierFingerprint: { hyperframes_cli: "test", browser: "test", node: "test", platform: "test", arch: "test" } };
  const first = await verifyProduction(workspace, {}, adapters);
  const second = await verifyProduction(workspace, {}, adapters);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.deepEqual(commands, ["lint", "validate", "check", "snapshot"]);
  const receipt = JSON.parse(await readFile(path.join(workspace, "production", "qa", "verification.json"), "utf8"));
  assert.equal(receipt.schema_version, "launchclip.production-verification.v6");
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.cacheable, true);
  assert.equal(receipt.snapshot_artifacts.files.length, 1);
});

test("invalidates verification reuse when project content or a receipt artifact changes", async () => {
  const workspace = await fixture();
  let commands = 0;
  const run = async (_command, args) => {
    commands += 1;
    if (args[1] === "snapshot") await writeFile(path.join(args[args.indexOf("--output") + 1], "frame-00.png"), `snapshot-${commands}`);
    return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" };
  };
  const adapters = { run, verifierFingerprint: { hyperframes_cli: "test", browser: "test", node: "test", platform: "test", arch: "test" } };
  await verifyProduction(workspace, {}, adapters);
  await writeFile(path.join(workspace, "production", "qa", "lint.json"), "tampered\n");
  const afterTamper = await verifyProduction(workspace, {}, adapters);
  assert.equal(afterTamper.cached, false);
  assert.equal(commands, 8);
  await writeFile(path.join(workspace, "production", "hyperframes", "index.html"), '<div data-composition-id="main" data-duration="10" data-width="1080" data-height="1920">changed</div>');
  const afterProjectChange = await verifyProduction(workspace, {}, adapters);
  assert.equal(afterProjectChange.cached, false);
  assert.equal(commands, 12);
});

test("rejects a verification receipt when the assembled project changes before render", async () => {
  const workspace = await fixture();
  const run = async (_command, args) => {
    if (args[1] === "snapshot") await writeFile(path.join(args[args.indexOf("--output") + 1], "frame-00.png"), "snapshot");
    return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" };
  };
  const verification = await verifyProduction(workspace, {}, { run, verifierFingerprint: { hyperframes_cli: "test", browser: "test" } });
  await writeFile(path.join(workspace, "production", "hyperframes", "index.html"), "changed after verification");
  await assert.rejects(() => assertVerificationFresh(workspace, verification, {}), (error) => error.code === "LAUNCHCLIP_STALE_PRODUCTION_VERIFICATION");
});

test("blocks production when a shot-local motion assertion fails", async () => {
  const workspace = await fixture();
  await addShotFixture(workspace);
  const run = async (_command, args) => {
    if (args[1] === "check" && args.at(-1).includes("shot-inspect")) {
      const error = new Error("missing selector");
      error.code = 1;
      error.stdout = JSON.stringify({ ok: false, issues: [{ code: "motion_selector_missing", severity: "error", selector: "#proof" }] });
      throw error;
    }
    return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" };
  };
  await assert.rejects(() => verifyProduction(workspace, {}, { run }), (error) => {
    assert.ok(error instanceof ProductionVerificationError);
    assert.equal(error.code, "LAUNCHCLIP_PRODUCTION_VERIFICATION_FAILED");
    assert.deepEqual(error.verification.failed, ["inspect:shot-1"]);
    assert.equal(error.verification.status, "failed");
    return true;
  });
  const report = JSON.parse(await readFile(path.join(workspace, "production", "qa", "shot-inspect", "shot-1", "inspect.json"), "utf8"));
  assert.equal(report.ok, false);
  assert.equal(report.stdout.issues[0].code, "motion_selector_missing");
});

test("fails closed when inspection returns structured errors with exit code zero", async () => {
  const workspace = await fixture();
  const run = async (_command, args) => ({
    stdout: args[1] === "check"
      ? JSON.stringify({ ok: false, issues: [{ code: "layout_overlap", severity: "error", message: "metric overlaps label" }] })
      : args.includes("--json") ? "{}" : "ok",
    stderr: ""
  });
  await assert.rejects(() => verifyProduction(workspace, {}, { run }), (error) => {
    assert.ok(error instanceof ProductionVerificationError);
    assert.deepEqual(error.verification.failed, ["inspect"]);
    return true;
  });
  const report = JSON.parse(await readFile(path.join(workspace, "production", "qa", "inspect.json"), "utf8"));
  assert.equal(report.ok, false);
  assert.equal(report.failure_kind, "content");
});

test("classifies unsupported verifier contracts as infrastructure failures", async () => {
  const workspace = await fixture();
  await addShotFixture(workspace);
  const run = async (_command, args) => {
    if (args[1] === "check" && args.at(-1).includes("shot-inspect")) {
      const error = new Error("unsupported motion contract");
      error.code = 1;
      error.stderr = "spec version 2 is not supported — upgrade the HyperFrames CLI";
      throw error;
    }
    return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" };
  };
  await assert.rejects(() => verifyProduction(workspace, {}, { run }), (error) => {
    assert.ok(error instanceof ProductionVerificationError);
    assert.equal(error.code, "LAUNCHCLIP_PRODUCTION_INFRASTRUCTURE_FAILED");
    assert.deepEqual(error.verification.infrastructure_failed, ["inspect:shot-1"]);
    assert.equal(error.verification.checks["inspect:shot-1"].failure_kind, "infrastructure");
    return true;
  });
  const receipt = JSON.parse(await readFile(path.join(workspace, "production", "qa", "verification.json"), "utf8"));
  assert.deepEqual(receipt.infrastructure_failed, ["inspect:shot-1"]);
  assert.match(receipt.checks["inspect:shot-1"].error, /spec version 2/i);
  assert.equal(classifyCommandFailure({ issues: [{ code: "motion_selector_missing" }] }, ""), "content");
});

test("blocks orphan SFX before launching browser verification", async () => {
  const workspace = await fixture();
  await addShotFixture(workspace);
  const planPath = path.join(workspace, "production", "plan.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  plan.shots[0].sfx = [{ at_seconds: 1, cue: "tick", event_id: "shot-1-proof-lock", intent: "mark proof", volume: .2 }];
  await writeFile(planPath, `${JSON.stringify(plan)}\n`);
  const motionPath = path.join(workspace, "production", "hyperframes", "compositions", "shot-1.motion.json");
  const motion = JSON.parse(await readFile(motionPath, "utf8"));
  motion.events = [];
  await writeFile(motionPath, `${JSON.stringify(motion)}\n`);
  let commands = 0;
  await assert.rejects(() => verifyProduction(workspace, {}, { run: async () => { commands += 1; return { stdout: "{}", stderr: "" }; } }), (error) => {
    assert.ok(error instanceof ProductionVerificationError);
    assert.deepEqual(error.verification.failed, ["semantic"]);
    return true;
  });
  assert.equal(commands, 0);
  const report = JSON.parse(await readFile(path.join(workspace, "production", "qa", "semantic.json"), "utf8"));
  assert.ok(report.stdout.errors.some((error) => error.includes("orphaned")));
});

test("fails closed when authored frames silently replace the planned type system", async () => {
  const plan = { design: { style_dna: { typography: { display: "Silkscreen", body: "Atkinson Hyperlegible", metadata: "IBM Plex Mono" } } } };
  const generic = [{ shot_id: "shot-1", html: '<style>.title{font-family:Arial,sans-serif}.meta{font:700 24px/1 "Courier New",monospace}</style>' }];
  assert.deepEqual(plannedTypographyErrors(plan, generic), [
    'planned typography role display requires family "Silkscreen", but no assembled frame declares it',
    'planned typography role body requires family "Atkinson Hyperlegible", but no assembled frame declares it',
    'planned typography role metadata requires family "IBM Plex Mono", but no assembled frame declares it'
  ]);
  const faithful = [{ shot_id: "shot-1", html: '<style>:root{--display:"Silkscreen";--body:"Atkinson Hyperlegible"}.title{font-family:var(--display)}.copy{font-family:var(--body)}.meta{font:500 24px/1 "IBM Plex Mono"}</style>' }];
  assert.deepEqual(plannedTypographyErrors(plan, faithful), []);

  const describedPlan = { design: { style_dna: { typography: {
    display: "Space Grotesk 700, tightly tracked",
    body: "Inter 500/600 with short labels",
    metadata: "IBM Plex Mono 500 for commands"
  } } } };
  const describedFaithful = [{ shot_id: "shot-1", html: '<style>.title{font-family:"Space Grotesk",sans-serif}.copy{font-family:Inter,sans-serif}.meta{font-family:"IBM Plex Mono",monospace}</style>' }];
  assert.deepEqual(plannedTypographyErrors(describedPlan, describedFaithful), []);
  assert.deepEqual(plannedTypographyErrors(describedPlan, generic), [
    'planned typography role display requires family "Space Grotesk", but no assembled frame declares it',
    'planned typography role body requires family "Inter", but no assembled frame declares it',
    'planned typography role metadata requires family "IBM Plex Mono", but no assembled frame declares it'
  ]);
});

test("blocks final rendering without approval and records failed HyperFrames checks", async () => {
  const workspace = await fixture();
  await assert.rejects(() => renderProduction(workspace), /requires explicit --approve/);
  const run = async (_command, args) => {
    if (args[1] === "check") { const error = new Error("overflow"); error.code = 1; error.stdout = '{"findings":[{"severity":"error"}]}'; throw error; }
    return { stdout: "{}", stderr: "" };
  };
  await assert.rejects(() => verifyProduction(workspace, {}, { run }), /inspect/);
  const inspect = JSON.parse(await readFile(path.join(workspace, "production", "qa", "inspect.json"), "utf8"));
  assert.equal(inspect.ok, false);
});

test("blocks a fully deterministic fallback assembly from final rendering", async () => {
  const workspace = await fixture();
  await writeFile(path.join(workspace, "production", "hyperframes", "assembly.json"), `${JSON.stringify({
    fallback_count: 1,
    full_fallback: true,
    fallbacks: [{ shot_id: "shot-1", source: "verification" }]
  })}\n`);
  let commands = 0;
  await assert.rejects(() => renderProduction(workspace, { approve: true }, {
    run: async () => { commands += 1; return { stdout: "{}", stderr: "" }; }
  }), (error) => error.code === "LAUNCHCLIP_FULL_FALLBACK_RENDER_BLOCKED");
  assert.equal(commands, 0);
});

test("fails verification on lint warnings because final rendering uses strict-all", async () => {
  const workspace = await fixture();
  const run = async (_command, args) => ({
    stdout: args[1] === "lint" ? JSON.stringify({ warningCount: 1, findings: [{ severity: "warning", code: "missing_editable_id" }] }) : args.includes("--json") ? "{}" : "ok",
    stderr: ""
  });
  await assert.rejects(() => verifyProduction(workspace, {}, { run }), /lint/);
  const verification = JSON.parse(await readFile(path.join(workspace, "production", "qa", "verification.json"), "utf8"));
  assert.equal(verification.checks.lint.strict_warning_count, 1);
});

test("renders only after verification then runs frame-by-frame motion gates", async () => {
  const workspace = await fixture();
  const sourceMedia = path.join(workspace, "production", "source-media");
  await mkdir(sourceMedia, { recursive: true });
  await writeFile(path.join(sourceMedia, "analysis.json"), `${JSON.stringify({ staged_references: [{ local_path: "/tmp/staged-reference.mp4" }] })}\n`);
  const commands = [];
  const run = async (_command, args) => { commands.push(args[1]); return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" }; };
  let motionInput;
  const result = await renderProduction(workspace, { approve: true, references: ["/tmp/reference.mp4"] }, {
    run,
    writeMotionReport: async (video, output, options) => {
      motionInput = { video, output, options };
      await writeFile(output, "{}\n");
      return { quality: { ok: true }, family: "rapid-hybrid" };
    },
    critiqueProduction: async () => ({ verdict: "ship", status: "approved" })
  });
  assert.equal(result.status, "awaiting-human-review");
  assert.equal(commands.at(-1), "render");
  assert.equal(motionInput.options.expected.width, 1080);
  assert.equal(motionInput.options.expected.maximum_hold_ratio, .94);
  assert.equal(motionInput.options.expected.minimum_bursts_per_minute, 8);
  assert.equal(motionInput.options.expected.minimum_change_energy_p50, .35);
  assert.equal(motionInput.options.expected.minimum_flow_velocity_p90, 2);
  assert.equal(motionInput.options.expected.maximum_first_motion_seconds, .65);
  assert.equal(motionInput.options.expected.hook_window_seconds, 4);
  assert.equal(motionInput.options.expected.minimum_hook_events, 2);
  assert.deepEqual(motionInput.options.references, ["/tmp/reference.mp4", "/tmp/staged-reference.mp4"]);
  assert.equal(JSON.parse(await readFile(result.audio, "utf8")).status, "not-requested");
});

test("renders a temporally analyzed draft before approval", async () => {
  const workspace = await fixture();
  const commands = [];
  const result = await renderDraftProduction(workspace, {}, {
    run: async (_command, args) => { commands.push(args); return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" }; },
    writeMotionReport: async (_video, output) => { await writeFile(output, "{}\n"); return { quality: { ok: true }, family: "developing-card" }; },
    critiqueProduction: async () => ({ verdict: "ship", status: "approved" })
  });
  const renderArgs = commands.find((args) => args[1] === "render");
  assert.equal(result.stage, "production-draft");
  assert.equal(result.status, "ready");
  assert.match(result.video, /production\/renders\/draft\.mp4$/);
  assert.equal(renderArgs[renderArgs.indexOf("--quality") + 1], "draft");
});

test("reuses unchanged native QA while still encoding and analyzing each draft", async () => {
  const workspace = await fixture();
  const commands = [];
  const adapters = {
    verifierFingerprint: { hyperframes_cli: "test", browser: "test", node: "test", platform: "test", arch: "test" },
    run: async (_command, args) => {
      commands.push(args[1]);
      if (args[1] === "snapshot") await writeFile(path.join(args[args.indexOf("--output") + 1], "frame-00.png"), "snapshot");
      return { stdout: args.includes("--json") ? "{}" : "ok", stderr: "" };
    },
    writeMotionReport: async (_video, output) => { await writeFile(output, "{}\n"); return { quality: { ok: true }, family: "developing-card" }; },
    critiqueProduction: async () => ({ verdict: "ship", status: "approved" })
  };
  const first = await renderDraftProduction(workspace, {}, adapters);
  const second = await renderDraftProduction(workspace, {}, adapters);
  assert.equal(first.verification.cached, false);
  assert.equal(second.verification.cached, true);
  assert.equal(commands.filter((name) => name === "lint").length, 1);
  assert.equal(commands.filter((name) => name === "render").length, 2);
});

test("blocks final approval when rendered audio fails deterministic gates", async () => {
  const workspace = await fixture();
  const media = path.join(workspace, "production", "media");
  await mkdir(media, { recursive: true });
  await writeFile(path.join(media, "manifest.json"), `${JSON.stringify({ voiceover: { path: "/tmp/voice.mp3" }, music: null, sfx_manifest: null })}\n`);
  await assert.rejects(() => renderProduction(workspace, { approve: true }, {
    run: async (_command, args) => ({ stdout: args.includes("--json") ? "{}" : "ok", stderr: "" }),
    writeMotionReport: async (_video, output) => { await writeFile(output, "{}\n"); return { quality: { ok: true }, family: "developing-card" }; },
    writeAudioReport: async (_video, _manifest, output) => { const report = { quality: { ok: false, findings: [{ severity: "major", category: "masking" }] } }; await writeFile(output, `${JSON.stringify(report)}\n`); return report; }
  }), /audio quality gates/);
});

test("returns a targeted repair state when the independent critic does not approve", async () => {
  const workspace = await fixture();
  const result = await renderProduction(workspace, { approve: true }, {
    run: async (_command, args) => ({ stdout: args.includes("--json") ? "{}" : "ok", stderr: "" }),
    writeMotionReport: async (_video, output) => { await writeFile(output, "{}\n"); return { quality: { ok: true }, family: "developing-card" }; },
    critiqueProduction: async () => ({ verdict: "repair", status: "needs-repair", findings: 2 })
  });
  assert.equal(result.status, "needs-repair");
  assert.equal(result.critique.findings, 2);
});

async function fixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "launchclip-render-"));
  await mkdir(path.join(workspace, "production", "hyperframes"), { recursive: true });
  await writeFile(path.join(workspace, "production", "plan.json"), `${JSON.stringify({ format: { duration_seconds: 10, width: 1080, height: 1920 } })}\n`);
  await writeFile(path.join(workspace, "production", "hyperframes", "index.html"), '<div data-composition-id="main" data-duration="10" data-width="1080" data-height="1920"></div>');
  return workspace;
}

async function addShotFixture(workspace) {
  const production = path.join(workspace, "production");
  const project = path.join(production, "hyperframes");
  const compositions = path.join(project, "compositions");
  const assets = path.join(project, "assets");
  await Promise.all([mkdir(compositions, { recursive: true }), mkdir(assets, { recursive: true })]);
  await writeFile(path.join(production, "plan.json"), `${JSON.stringify({
    format: { duration_seconds: 10, width: 1080, height: 1920, language: "en" },
    shots: [{
      id: "shot-1", start_seconds: 0, end_seconds: 10, presenter: { mode: "voiceover" }, resource_ids: [], sfx: [],
      visual: {
        representation: "diagram",
        objects: [
          { id: "proof-field", kind: "decoration", layer: "background", asset_resource_id: null },
          { id: "proof-node", kind: "diagram-node", layer: "midground", asset_resource_id: null },
          { id: "proof-label", kind: "text", layer: "foreground", asset_resource_id: null }
        ],
        events: [{ id: "shot-1-proof-lock", at_seconds: 1, target_ids: ["proof-node"], sfx_eligible: true }],
        continuity: { sequence_id: "proof-sequence", handoff: "resolve", inherits_object_ids: [], hands_off_object_ids: [], entry_velocity: 0, exit_velocity: 0 }
      }
    }]
  })}\n`);
  await writeFile(path.join(compositions, "shot-1.html"), '<!doctype html><html><body><template><style>#root{position:absolute;inset:0}</style><div id="root" data-composition-id="shot-1" data-start="0" data-duration="10" data-width="1080" data-height="1920"><img id="proof" src="assets/proof.png"></div><script>const timeline=gsap.timeline({paused:true});window.__timelines=window.__timelines||{};window.__timelines["shot-1"]=timeline;</script></template></body></html>');
  await writeFile(path.join(compositions, "shot-1.motion.json"), `${JSON.stringify({ version: 1, duration: 10, assertions: [{ kind: "appearsBy", selector: "#proof", bySec: 1 }], events: [{ event_id: "shot-1-proof-lock", object_id: "proof-node", selector: "#proof", at_seconds: 1, property: "opacity", visible_change: true }] })}\n`);
  await writeFile(path.join(assets, "proof.png"), "proof-image");
}
