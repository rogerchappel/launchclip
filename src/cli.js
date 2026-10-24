import { analyzeRender, initWorkspace, runDemo, planVideo, writeCaptions, renderVideo, submitReview, writeReview, runPacket, validateWorkspace } from "./pipeline.js";
import { writeTeleprompter, alignRecording, renderMotion } from "./talking_head.js";
import { generateMusic } from "./music.js";
import { runDirect } from "./director.js";
import { preprocessPresenter } from "./presenter_preprocess.js";
import { writeIntake } from "./intake.js";
import { runProductionStage } from "./production_cli.js";
import { isProductionReviewWorkspace } from "./production_review.js";
import { createCostTracker, parseCostLimit } from "./cost_tracker.js";
import { diagnoseInstallation, VERSION } from "./doctor.js";
import { createStylePack, listBuiltinStyles, listStylePacks, projectStyleRoot, resolveStylePack, resolveStyleV2, upgradeStylePack } from "./style_store.js";
import { checkStyleCommand, createStyleFromReferences } from "./style_commands.js";
import { checkCinematicProject } from "./cinematic_check.js";
import { bundledSkillPath, installBundledSkills, listBundledSkills } from "./skill_install.js";
import { prepareRecording, recordingOptions, writeBrollPlan } from "./recording_workflow.js";
import { runStoryCommand } from "./story_cli.js";
import { commandHelp, helpText, USAGE_GROUPS, wantsHelp } from "./cli_usage.js";
import { parseSubjectInvocation } from "./subject/cli.js";

const PRODUCTION_COMMANDS = new Set(["evidence", "source-preprocess", "source-media", "resolve-entities", "concept-tournament", "retention-story", "cinematic-narration", "creative-plan", "direct-frames", "production-audio", "assemble", "production-verify", "production-draft", "production-preview", "production-critique", "production-repair", "production-render", "produce"]);
const COMMANDS = new Set(["doctor", "skills", "style", "intake", ...PRODUCTION_COMMANDS, "edit-recording", "broll-plan", "cinematic-check", "layout-check", "module", "subject", "story", "finish", "make", "voice", "export", "sfx", "init", "demo", "plan", "captions", "render", "analyze-render", "submit-review", "review", "validate", "run", "script", "align", "motion-render", "music", "direct", "preprocess-presenter"]);

export async function runCli(argv, io = {}) {
  const { stdout = process.stdout, stderr = process.stderr, stdin = process.stdin, fetch: baseFetch = globalThis.fetch, doctor = diagnoseInstallation, productionAdapters = {}, skillOptions = {} } = io;
  const [command, firstArg, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    stdout.write(help());
    return;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    stdout.write(`${VERSION}\n`);
    return;
  }
  if (!COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }
  // `launchclip <command> [action] --help | -h`: that command's usage, before
  // any argument parsing (a project path or a flag value is never required).
  const commandArgs = [firstArg, ...rest].filter((arg) => arg !== undefined);
  if (wantsHelp(commandArgs)) {
    const action = USAGE_GROUPS.includes(command) && firstArg && !firstArg.startsWith("-") ? firstArg : null;
    stdout.write(commandHelp(command, action) ?? help());
    return;
  }

  const styleInvocation = command === "style" ? parseStyleInvocation(firstArg, rest) : null;
  const skillsInvocation = command === "skills" ? parseSkillsInvocation(firstArg, rest) : null;
  const storyInvocation = command === "story" ? parseStoryInvocation(firstArg, rest) : null;
  const sfxInvocation = command === "sfx" ? parseSfxInvocation(firstArg, rest) : null;
  const moduleInvocation = command === "module" ? parseModuleInvocation(firstArg, rest) : null;
  const subjectInvocation = command === "subject" ? parseSubjectInvocation(firstArg, rest) : null;
  // launchclip voice takes a project or only flags (--text "...").
  const voiceInvocation = command === "voice" ? (firstArg && !firstArg.startsWith("--") ? { project: firstArg, flagArgs: rest } : { project: null, flagArgs: firstArg ? [firstArg, ...rest] : rest }) : null;
  // launchclip demo record|approve|scene <path> [flags]; plain `demo <repo>` is the packet lane.
  const demoTarget = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const demoInvocation = command === "demo" && ["record", "approve", "scene", "doctor", "shots"].includes(firstArg) ? { action: firstArg, target: demoTarget, flagArgs: demoTarget ? rest.slice(1) : rest } : null;
  const flags = parseFlags(styleInvocation?.flagArgs ?? skillsInvocation?.flagArgs ?? storyInvocation?.flagArgs ?? sfxInvocation?.flagArgs ?? voiceInvocation?.flagArgs ?? moduleInvocation?.flagArgs ?? subjectInvocation?.flagArgs ?? demoInvocation?.flagArgs ?? rest);
  const tracker = createCostTracker({ fetch: baseFetch, limitUsd: parseCostLimit(flags["max-cost-usd"] ?? process.env.LAUNCHCLIP_MAX_COST_USD) });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = tracker.fetch;
  try {
    let result;
    if (command === "doctor") {
      result = await doctor();
    } else if (command === "skills") {
      result = await runSkillsCommand(skillsInvocation.action, skillsInvocation.name, flags, skillOptions);
    } else if (command === "style") {
      result = await runStyleCommand(styleInvocation.action, styleInvocation.name, flags);
    } else if (command === "intake") {
      result = await writeIntake(required(firstArg, "source"), flags);
    } else if (command === "edit-recording") {
      result = await prepareRecording(required(firstArg, "recording media path"), recordingOptions(flags), productionAdapters.recording);
    } else if (command === "broll-plan") {
      result = await writeBrollPlan(required(firstArg, "word-timed transcript path"), {
        out: flags.out, aspect: flags.aspect, durationSeconds: flags.duration == null ? undefined : Number(flags.duration)
      });
    } else if (PRODUCTION_COMMANDS.has(command)) {
      result = await runProductionStage(command, required(firstArg, command === "produce" ? "source" : "workspace path"), flags, {
        ...productionAdapters,
        review: { input: stdin, output: stderr, ...productionAdapters.review }
      });
    } else if (command === "sfx") {
      const { runSfxCommand } = await import("./sfx/seed.js");
      result = await runSfxCommand(sfxInvocation.action, sfxInvocation.name, flags, { log: (line) => stderr.write(`${line}\n`) });
    } else if (command === "story") {
      result = await runStoryCommand(storyInvocation.action, storyInvocation.file, flags, productionAdapters.story ?? {});
    } else if (command === "cinematic-check") {
      result = await checkCinematicProject(required(firstArg, "project path"), {
        ...flags,
        expectAudio: Boolean(flags["expect-audio"]),
        // --music-volume (documented) or the older --musicVolume spelling.
        musicVolume: flags["music-volume"] ?? flags.musicVolume,
        audioManifest: flags["audio-manifest"],
        qaDir: flags["qa-dir"]
      }, productionAdapters.cinematicCheck);
    } else if (command === "module") {
      const { runModuleFit, formatModuleFit } = await import("./module_fit.js");
      const report = await runModuleFit(moduleInvocation.name, flags);
      if (!flags.json) {
        stdout.write(formatModuleFit(report));
        return;
      }
      result = report;
    } else if (command === "subject") {
      const { runSubjectCommand, formatSubjectReport } = await import("./subject/cli.js");
      const report = await runSubjectCommand(subjectInvocation.action, subjectInvocation.media, flags, { log: (line) => stderr.write(`${line}\n`) });
      if (!flags.json) {
        stdout.write(formatSubjectReport(report));
        return;
      }
      result = report;
    } else if (command === "layout-check") {
      const { checkLayoutProject, formatLayoutReport } = await import("./layout_check.js");
      const report = await checkLayoutProject(required(firstArg, "story project path"), { profile: flags.profile }, productionAdapters.layoutCheck);
      if (!flags.json) {
        stdout.write(formatLayoutReport(report));
        return;
      }
      result = report;
    } else if (command === "finish") {
      const { runFinish, formatFinishSummary } = await import("./finish.js");
      const report = await runFinish(required(firstArg, "story project path"), {
        renderer: flags.renderer,
        quality: flags.quality,
        voice: flags.voice,
        music: flags.music,
        out: flags.out,
        force: Boolean(flags.force),
        musicRegenerate: Boolean(flags["music-regenerate"]),
        scenes: flags.scene,
        previewScene: flags["preview-scene"],
        sfxLibrary: flags["sfx-library"],
        sfxDensity: flags["sfx-density"],
        candidate: flags.candidate,
        into: flags.into,
        comparison: flags.comparison,
        kind: flags.kind,
        boundary: flags.boundary,
        at: flags.at
      }, productionAdapters.finish);
      throwIfCostLimited(tracker);
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatFinishSummary(report));
      if (report.status === "failed") {
        const failedStage = report.stages.find((stage) => stage.status === "failed");
        throw new Error(`launchclip finish failed at the ${failedStage?.name ?? "unknown"} stage: ${failedStage?.error ?? ""}`.trim());
      }
      return;
    } else if (command === "make") {
      const { runMake, formatMakeSummary } = await import("./make/index.js");
      if (!firstArg || firstArg.startsWith("--")) throw new Error("launchclip make needs a prompt: launchclip make \"A 30-second launch video for ...\" [--assets ./assets]");
      const report = await runMake(firstArg, {
        assets: flags.assets,
        aspect: flags.aspect,
        duration: flags.duration,
        style: flags.style,
        model: flags.model,
        voice: flags.voice,
        music: flags.music,
        renderer: flags.renderer,
        quality: flags.quality,
        out: flags.out,
        replan: Boolean(flags.replan),
        critic: flags["no-critic"] ? false : flags.critic ? true : undefined,
        maxRepairs: flags["max-repairs"] === undefined ? undefined : Number(flags["max-repairs"]),
        repo: flags.repo,
        approveDemo: Boolean(flags["approve-demo"]),
        redemo: Boolean(flags.redemo),
        start: flags.start,
        url: flags.url,
        allowHost: flags["allow-host"],
        demoPlan: flags["demo-plan"],
        ...(flags["no-subject"] ? { subject: false } : {})
      }, { notice: (line) => stderr.write(`${line}\n`), ...productionAdapters.make });
      throwIfCostLimited(tracker);
      // The tracked HTTP costs (actual usage, cache pricing included) join make's own estimates.
      report.api_costs = tracker.summary();
      await (await import("node:fs/promises")).writeFile((await import("node:path")).join(report.project, "MAKE.json"), `${JSON.stringify(report, null, 2)}\n`);
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatMakeSummary(report));
      if (report.status === "failed") throw new Error(`launchclip make failed at the ${report.failed_stage} stage: ${report.stages[report.failed_stage]?.error ?? ""}\nnext: ${report.next_steps[0] ?? ""}`.trim());
      return;
    } else if (command === "voice") {
      const { runVoiceCommand } = await import("./voice_cli.js");
      const report = await runVoiceCommand(voiceInvocation.project, { text: flags.text, voice: flags.voice, provider: flags.provider, speed: flags.speed, out: flags.out }, productionAdapters.voice);
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : report.report);
      return;
    } else if (command === "export") {
      const { runExport, formatExportSummary } = await import("./nle/export.js");
      const report = await runExport(required(firstArg, "story project path"), {
        format: flags.format,
        overlays: flags.overlays,
        out: flags.out,
        fps: flags.fps,
        name: flags.name,
        absolute: Boolean(flags.absolute),
        force: Boolean(flags.force),
        dtd: flags.dtd,
        concurrency: flags.concurrency
      }, { log: flags.json ? () => {} : (message) => stderr.write(`export: ${message}\n`), ...productionAdapters.export });
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatExportSummary(report));
      if (report.status === "failed") throw new Error(`launchclip export wrote ${report.export_dir} but its validation failed: ${Object.entries(report.validation).filter(([, entry]) => entry.status === "failed").map(([key]) => key).join(", ")}`);
      return;
    } else if (command === "init") {
      result = await initWorkspace(required(firstArg, "repo path"), flags);
    } else if (command === "demo" && firstArg === "doctor") {
      const { runDoctor, formatDoctor } = await import("./demo/doctor.js");
      const { askYesNo } = await import("./demo/autopilot.js");
      const report = await runDoctor(demoInvocation.target, flags, { log: (line) => stderr.write(`demo doctor: ${line}\n`), ask: (question) => askYesNo(question, { input: stdin }) });
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatDoctor(report));
      if (!report.ok) throw new Error(`launchclip demo doctor: ${report.summary.fail} check(s) failed`);
      return;
    } else if (command === "demo" && ["record", "approve", "scene", "shots"].includes(firstArg)) {
      const { runDemoCommand } = await import("./demo/cli.js");
      result = await runDemoCommand(demoInvocation.action, demoInvocation.target, flags, { log: (line) => stderr.write(`demo: ${line}\n`), stdin });
    } else if (command === "demo") {
      result = await runDemo(required(firstArg, "repo path"), flags);
    } else if (command === "plan") {
      result = await planVideo(required(firstArg, "workspace path"), flags);
    } else if (command === "captions") {
      result = await writeCaptions(required(firstArg, "workspace path"), flags);
    } else if (command === "render") {
      result = await renderVideo(required(firstArg, "workspace path"), flags);
    } else if (command === "analyze-render") {
      result = await analyzeRender(required(firstArg, "workspace path"), flags);
    } else if (command === "submit-review") {
      result = await submitReview(required(firstArg, "workspace path"), flags);
    } else if (command === "review") {
      const workspace = required(firstArg, "workspace path");
      const productionReview = await isProductionReviewWorkspace(workspace);
      result = productionReview
        ? await runProductionStage("production-review", workspace, flags, {
            ...productionAdapters,
            review: { input: stdin, output: stderr, ...productionAdapters.review }
          })
        : await writeReview(workspace, flags);
    } else if (command === "validate") {
      result = await validateWorkspace(required(firstArg, "workspace path"), { ...flags, write: true });
    } else if (command === "run") {
      result = await runPacket(required(firstArg, "repo path"), flags);
    } else if (command === "script") {
      result = await writeTeleprompter(required(firstArg, "workspace path"), flags);
    } else if (command === "align") {
      result = await alignRecording(required(firstArg, "workspace path"), flags);
    } else if (command === "motion-render") {
      result = await renderMotion(required(firstArg, "workspace path"), flags);
    } else if (command === "music") {
      result = await generateMusic(required(firstArg, "workspace path"), flags);
    } else if (command === "direct") {
      result = await runDirect(required(firstArg, "workspace path"), flags);
    } else if (command === "preprocess-presenter") {
      result = await preprocessPresenter(required(firstArg, "presenter media path"), flags);
    }
    throwIfCostLimited(tracker);
    const output = result && typeof result === "object" && !Array.isArray(result)
      ? { ...result, costs: tracker.summary() }
      : { result, costs: tracker.summary() };
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    // A wrapped or downstream failure after the spending limit tripped is reported as the limit.
    const failure = tracker.limitError() ?? (error instanceof Error ? error : new Error(String(error)));
    failure.costs = tracker.summary();
    throw failure;
  } finally {
    if (globalThis.fetch === tracker.fetch) globalThis.fetch = previousFetch;
  }
}

function throwIfCostLimited(tracker) {
  const error = tracker.limitError();
  if (error) throw error;
}

async function runSkillsCommand(action, name, flags, options) {
  if (action === "list") return listBundledSkills(options);
  if (action === "path") {
    return {
      stage: "skills",
      action,
      status: "ready",
      name: name ?? null,
      path: bundledSkillPath(name, options)
    };
  }
  return installBundledSkills({ ...options, agent: flags.agent, skill: flags.skill, force: Boolean(flags.force) });
}

function parseSkillsInvocation(action, rest) {
  if (!action) throw new Error("Missing skills action; use list, path, or install");
  if (!new Set(["list", "path", "install"]).has(action)) throw new Error(`Unknown skills action: ${action}`);
  const hasName = action === "path" && rest[0] && !rest[0].startsWith("--");
  return { action, name: hasName ? rest[0] : null, flagArgs: hasName ? rest.slice(1) : rest };
}

function parseSfxInvocation(action, rest) {
  if (!action) throw new Error("Missing sfx action; use seed, reroll, list or audition");
  if (!new Set(["seed", "reroll", "list", "audition"]).has(action)) throw new Error(`Unknown sfx action: ${action}`);
  const takesName = action === "audition" || action === "reroll";
  const hasName = takesName && rest[0] && !rest[0].startsWith("--");
  if (action === "audition" && !hasName) throw new Error("Missing SFX family to audition, e.g. launchclip sfx audition keystroke");
  return { action, name: hasName ? rest[0] : null, flagArgs: hasName ? rest.slice(1) : rest };
}

function parseStoryInvocation(action, rest) {
  if (!action) throw new Error("Missing story action; use validate, resolve, compile or plan");
  if (!new Set(["validate", "resolve", "compile", "plan"]).has(action)) throw new Error(`Unknown story action: ${action}`);
  if (action === "plan") return { action, file: null, flagArgs: rest };
  const file = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  return { action, file: required(file, action === "compile" ? "story project path" : "story.json path"), flagArgs: rest.slice(1) };
}

async function runStyleCommand(action, name, flags) {
  const root = flags.root ?? flags["style-root"];
  if (action === "create" && (flags["from-reference"] || flags["from-images"])) {
    return createStyleFromReferences(required(name, "style name"), flags, { root });
  }
  if (action === "upgrade") return upgradeStylePack(required(name, "style name"), { root });
  if (action === "check") return checkStyleCommand(required(name, "project path"), flags, { root });
  if (action === "create" || action === "save") {
    const result = await createStylePack(required(name, "style name"), { from: flags.from, root, force: Boolean(flags.force) });
    return { ...result, action };
  }
  if (action === "list") {
    return { stage: "style", action, status: "ready", root: projectStyleRoot({ root }), styles: await listStylePacks({ root }), builtin: await listBuiltinStyles() };
  }
  const pack = await resolveStylePack(required(name, "style name or path"), { root }).catch(() => null);
  if (!pack || pack.pack) {
    const v2 = await resolveStyleV2(name, { root });
    return { stage: "style", action: "show", status: "ready", name: v2.name, source: v2.source, path: v2.file, pack: v2.pack, upgraded_in_memory: v2.upgraded, warnings: v2.warnings };
  }
  return {
    stage: "style",
    action: "show",
    status: "ready",
    name: pack.name,
    path: pack.path,
    manifest: pack.manifest,
    specification: pack.specification_path,
    caption_skin: pack.caption_skin_path,
    fonts: pack.fonts
  };
}

function parseStyleInvocation(action, rest) {
  if (!action) throw new Error("Missing style action; use create, save, list, show, upgrade or check");
  if (!new Set(["create", "save", "list", "show", "upgrade", "check"]).has(action)) throw new Error(`Unknown style action: ${action}`);
  const takesName = action !== "list";
  const hasName = takesName && rest[0] && !rest[0].startsWith("--");
  const flagArgs = hasName ? rest.slice(1) : rest;
  // --from-reference a.mp4 b.mp4 / --from-images x.png y.png take several files.
  const expanded = [];
  let multi = null;
  for (const token of flagArgs) {
    if (token.startsWith("--")) { multi = ["--from-reference", "--from-images", "--font-hint"].includes(token) ? token : null; expanded.push(token); continue; }
    if (multi && expanded.at(-1) !== multi) expanded.push(multi);
    expanded.push(token);
  }
  return { action, name: hasName ? rest[0] : null, flagArgs: expanded };
}

function parseModuleInvocation(action, rest) {
  if (action !== "fit") throw new Error("Usage: launchclip module fit <module> [--params params.json] [--aspect 16:9|9:16] [--story storyboard.json] [--brand brand.json] [--duration 4] [--json]");
  const [name, ...flagArgs] = rest;
  if (!name || name.startsWith("--")) throw new Error("module fit needs a module id, e.g. launchclip module fit checklist --params params.json --aspect 16:9");
  return { name, flagArgs };
}

export function parseFlags(args) {
  const flags = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const name = token.slice(2);
    if (name === "keep-fillers" || name === "no-audio-silence" || name === "edit-recording" || name === "dry-run" || name === "submit" || name === "no-render" || name === "force" || name === "approve" || name === "review" || name === "critic-pro" || name === "transcribe-all" || name === "allow-placeholder-sfx" || name === "allow-frame-fallback" || name === "repair-text-only" || name === "repair-scoped-source" || name === "refresh-free-models" || name === "no-music" || name === "no-voice" || name === "no-sfx" || name === "no-audio" || name === "no-open" || name === "allow-timing-drift" || name === "foreground" || name === "fast-eval" || name === "no-trim-silence" || name === "skip-quality-gates" || name === "skip-hyperframes-quality" || name === "strict" || name === "strict-all" || name === "pro" || name === "expect-audio" || name === "json" || name === "absolute" || name === "music-regenerate" || name === "missing" || name === "no-seed" || name === "no-start" || name === "plan-only" || name === "headed" || name === "reject" || name === "replan" || name === "critic" || name === "no-critic" || name === "approve-demo" || name === "redemo" || name === "no-download" || name === "no-subject") {
      flags[name] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    if (Object.hasOwn(flags, name)) {
      flags[name] = Array.isArray(flags[name]) ? [...flags[name], value] : [flags[name], value];
    } else {
      flags[name] = value;
    }
    index += 1;
  }
  return flags;
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}

function help() {
  return helpText();
}
