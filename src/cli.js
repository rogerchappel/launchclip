import path from "node:path";
import { analyzeRender, initWorkspace, runDemo, planVideo, writeCaptions, renderVideo, submitReview, writeReview, runPacket, validateWorkspace } from "./pipeline.js";
import { writeTeleprompter, alignRecording, renderMotion } from "./talking_head.js";
import { generateMusic } from "./music.js";
import { runDirect } from "./director.js";
import { preprocessPresenter } from "./presenter_preprocess.js";
import { writeIntake } from "./intake.js";
import { runProductionStage } from "./production_cli.js";
import { isProductionReviewWorkspace } from "./production_review.js";
import { ownConnectionFetch } from "./own_connection_fetch.js";
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
const COMMANDS = new Set(["doctor", "queue", "library", "skills", "style", "profile", "skeletons", "cast", "bible", "collection", "recipe", "intake", ...PRODUCTION_COMMANDS, "edit-recording", "broll-plan", "cinematic-check", "layout-check", "module", "subject", "story", "finish", "preview", "publish-manifest", "make", "research", "history", "fx", "voice", "export", "cutdown", "sfx", "init", "demo", "plan", "captions", "render", "analyze-render", "submit-review", "review", "validate", "run", "script", "align", "motion-render", "music", "direct", "preprocess-presenter"]);

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
  const libraryInvocation = command === "library" ? parseLibraryInvocation(firstArg, rest) : null;
  const skillsInvocation = command === "skills" ? parseSkillsInvocation(firstArg, rest) : null;
  const castInvocation = command === "cast" ? parseCastInvocation(firstArg, rest) : null;
  const storyInvocation = command === "story" ? parseStoryInvocation(firstArg, rest) : null;
  // launchclip bible freeze|show <project> [flags]
  const bibleProject = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const bibleInvocation = command === "bible" ? { action: firstArg, project: bibleProject, flagArgs: bibleProject ? rest.slice(1) : rest } : null;
  // launchclip profile list | show <id> | measure <folder> [flags]
  const profileTarget = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const profileInvocation = command === "profile" ? { action: firstArg, target: profileTarget, flagArgs: profileTarget ? rest.slice(1) : rest } : null;
  // launchclip skeletons list | show <id> | choose "<prompt>" [flags]
  const skeletonsTarget = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const skeletonsInvocation = command === "skeletons" ? { action: firstArg, target: skeletonsTarget, flagArgs: skeletonsTarget ? rest.slice(1) : rest } : null;
  const sfxInvocation = command === "sfx" ? parseSfxInvocation(firstArg, rest) : null;
  const collectionInvocation = command === "collection" || command === "recipe" ? parseCollectionInvocation(command, firstArg, rest) : null;
  const moduleInvocation = command === "module" ? parseModuleInvocation(firstArg, rest) : null;
  const subjectInvocation = command === "subject" ? parseSubjectInvocation(firstArg, rest) : null;
  // launchclip script check <file> [flags]; plain `script <workspace>` is the teleprompter.
  const scriptCheckFile = command === "script" && firstArg === "check" && rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const scriptCheckInvocation = command === "script" && firstArg === "check" ? { file: scriptCheckFile, flagArgs: scriptCheckFile ? rest.slice(1) : rest } : null;
  // launchclip history check <dir> [flags]
  const historyDir = command === "history" && rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const historyInvocation = command === "history" ? { action: firstArg, dir: historyDir, flagArgs: historyDir ? rest.slice(1) : rest } : null;
  // launchclip fx <video> <module> [flags]
  const fxInvocation = command === "fx" ? { video: firstArg && !firstArg.startsWith("--") ? firstArg : null, module: rest[0] && !rest[0].startsWith("--") ? rest[0] : null, flagArgs: rest[0] && !rest[0].startsWith("--") ? rest.slice(1) : rest } : null;
  // launchclip voice takes a project or only flags (--text "...").
  const voiceInvocation = command === "voice" ? (firstArg && !firstArg.startsWith("--") ? { project: firstArg, flagArgs: rest } : { project: null, flagArgs: firstArg ? [firstArg, ...rest] : rest }) : null;
  // launchclip demo record|approve|scene <path> [flags]; plain `demo <repo>` is the packet lane.
  const demoTarget = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const demoInvocation = command === "demo" && ["record", "approve", "scene", "doctor", "shots"].includes(firstArg) ? { action: firstArg, target: demoTarget, flagArgs: demoTarget ? rest.slice(1) : rest } : null;
  // launchclip evidence capture|check|scene <file> [flags]; plain `evidence <workspace>` is the production stage.
  const evidenceTarget = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const evidenceInvocation = command === "evidence" && ["capture", "check", "scene"].includes(firstArg) ? { action: firstArg, target: evidenceTarget, flagArgs: evidenceTarget ? rest.slice(1) : rest } : null;
  // launchclip research attach [dir] [flags]
  const researchAttachTarget = command === "research" && firstArg === "attach" && rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const researchAttachInvocation = command === "research" && firstArg === "attach" ? { target: researchAttachTarget ?? "research", flagArgs: researchAttachTarget ? rest.slice(1) : rest } : null;
  // launchclip research capture [dir] [flags]
  const researchCaptureTarget = command === "research" && firstArg === "capture" && rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  const researchCaptureInvocation = command === "research" && firstArg === "capture" ? { target: researchCaptureTarget ?? "research", flagArgs: researchCaptureTarget ? rest.slice(1) : rest } : null;
  const flags = parseFlags(researchCaptureInvocation?.flagArgs ?? researchAttachInvocation?.flagArgs ?? evidenceInvocation?.flagArgs ?? libraryInvocation?.flagArgs ?? styleInvocation?.flagArgs ?? skillsInvocation?.flagArgs ?? castInvocation?.flagArgs ?? bibleInvocation?.flagArgs ?? collectionInvocation?.flagArgs ?? storyInvocation?.flagArgs ?? profileInvocation?.flagArgs ?? skeletonsInvocation?.flagArgs ?? sfxInvocation?.flagArgs ?? voiceInvocation?.flagArgs ?? moduleInvocation?.flagArgs ?? subjectInvocation?.flagArgs ?? scriptCheckInvocation?.flagArgs ?? historyInvocation?.flagArgs ?? fxInvocation?.flagArgs ?? demoInvocation?.flagArgs ?? (command === "doctor" ? rest.filter((arg) => arg !== "--agent") : rest));
  // Model calls in flight together each take their own connection (src/own_connection_fetch.js); a fetch the caller passed is used as it is.
  const tracker = createCostTracker({ fetch: io.fetch ? baseFetch : ownConnectionFetch(baseFetch), limitUsd: parseCostLimit(flags["max-cost-usd"] ?? process.env.LAUNCHCLIP_MAX_COST_USD) });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = tracker.fetch;
  try {
    let result;
    // doctor and queue take only flags, so their first argument is one of them.
    // doctor's --agent is a switch (elsewhere --agent names one), so it is read apart.
    const doctorAgent = command === "doctor" && commandArgs.includes("--agent");
    const doctorFlags = command === "doctor" || command === "queue" ? parseFlags(commandArgs.filter((arg) => !(doctorAgent && arg === "--agent"))) : null;
    if (command === "queue") {
      const { readQueue, formatQueue } = await import("./queue.js");
      const report = await readQueue();
      stdout.write(doctorFlags.json ? `${JSON.stringify(report, null, 2)}\n` : formatQueue(report));
      return;
    }
    if (doctorFlags?.capacity) {
      const { diagnoseCapacity, formatCapacity } = await import("./capacity.js");
      const report = await (productionAdapters.capacity ?? diagnoseCapacity)();
      stdout.write(doctorFlags.json ? `${JSON.stringify(report, null, 2)}\n` : formatCapacity(report));
      return;
    } else if (doctorFlags?.models) {
      const { diagnoseModels } = await import("./doctor.js");
      const { formatModelAccess } = await import("./make/models.js");
      const report = await (productionAdapters.models ?? diagnoseModels)({ model: typeof doctorFlags.model === "string" ? doctorFlags.model : undefined, agent: doctorAgent });
      stdout.write(doctorFlags.json ? `${JSON.stringify(report, null, 2)}\n` : formatModelAccess(report));
      return;
    } else if (command === "doctor") {
      result = await doctor();
    } else if (command === "library") {
      const { initLibrary } = await import("./library.js");
      result = await initLibrary(libraryInvocation.target, { projects: flags.projects, finals: flags.finals, cache: flags.cache, name: flags.name, minFreeGb: flags["min-free-gb"], force: Boolean(flags.force) });
    } else if (command === "skills") {
      result = await runSkillsCommand(skillsInvocation.action, skillsInvocation.name, flags, skillOptions);
    } else if (command === "style") {
      result = await runStyleCommand(styleInvocation.action, styleInvocation.name, flags, styleInvocation.names);
    } else if (command === "profile") {
      const { runProfileCommand } = await import("./profile_cli.js");
      result = await runProfileCommand(profileInvocation.action, profileInvocation.target, flags, productionAdapters.profile ?? {});
    } else if (command === "skeletons") {
      const { runSkeletonsCommand } = await import("./skeletons.js");
      result = await runSkeletonsCommand(skeletonsInvocation.action, skeletonsInvocation.target, flags);
    } else if (command === "cast") {
      const { runCastCommand } = await import("./cast.js");
      result = await runCastCommand(castInvocation.action, castInvocation.name, castInvocation.action === "export" ? { ...flags, names: castInvocation.names } : flags);
    } else if (command === "bible") {
      const { runBibleCommand } = await import("./bible.js");
      if (!["freeze", "show"].includes(bibleInvocation.action)) throw new Error(`${bibleInvocation.action ? `Unknown bible action: ${bibleInvocation.action}` : "Missing bible action"}; use freeze or show`);
      result = await runBibleCommand(bibleInvocation.action, bibleInvocation.project, flags, productionAdapters.bible ?? {});
      if (bibleInvocation.action === "show" && !result.valid) {
        stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        throw new Error(`launchclip bible show: ${result.errors.length} error(s) in ${result.file}`);
      }
    } else if (command === "collection" || command === "recipe") {
      const { collectionNewCommand, collectionShowCommand, formatCollectionShow, recipeNewCommand } = await import("./collection_cli.js");
      if (command === "recipe") result = await recipeNewCommand(collectionInvocation.target, flags);
      else if (collectionInvocation.action === "new") result = await collectionNewCommand(collectionInvocation.target, flags);
      else {
        const { loadLibrary } = await import("./library.js");
        const report = await collectionShowCommand(collectionInvocation.target, flags, { library: await loadLibrary({ library: flags.library }) });
        stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatCollectionShow(report));
        return;
      }
    } else if (command === "intake") {
      const { loadLibrary } = await import("./library.js");
      result = await writeIntake(required(firstArg, "source"), flags, process.env, { library: await loadLibrary({ library: flags.library }) });
    } else if (command === "edit-recording") {
      result = await prepareRecording(required(firstArg, "recording media path"), recordingOptions(flags), productionAdapters.recording);
    } else if (command === "broll-plan") {
      result = await writeBrollPlan(required(firstArg, "word-timed transcript path"), {
        out: flags.out, aspect: flags.aspect, durationSeconds: flags.duration == null ? undefined : Number(flags.duration)
      });
    } else if (evidenceInvocation) {
      const { runEvidenceCommand } = await import("./evidence/cli.js");
      result = await runEvidenceCommand(evidenceInvocation.action, evidenceInvocation.target, flags, { log: (line) => stderr.write(`evidence: ${line}\n`) });
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
      // The shot list reads as text; --json prints the report.
      if (storyInvocation.action === "shots") {
        const { formatShots } = await import("./story_shots.js");
        stdout.write(flags.json ? `${JSON.stringify(result, null, 2)}\n` : formatShots(result));
        return;
      }
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
    } else if (command === "preview") {
      const { buildPreview, servePreview, formatPreviewSummary } = await import("./preview.js");
      const target = required(firstArg, "story project path");
      const exportDir = typeof flags.export === "string" ? flags.export : null;
      // --export writes the static folder and stops; otherwise it is served until interrupted.
      const built = exportDir
        ? await buildPreview(target, { out: exportDir }, productionAdapters.preview)
        : await servePreview(target, { port: flags.port, open: !flags["no-open"] }, productionAdapters.preview);
      if (!flags.json) {
        stdout.write(formatPreviewSummary(built));
        return;
      }
      const { close, ...report } = built;
      result = report;
    } else if (command === "finish") {
      const { runFinish, formatFinishSummary } = await import("./finish.js");
      const { loadLibrary, useLibraryCache } = await import("./library.js");
      const library = await loadLibrary({ library: flags.library });
      const restoreCache = useLibraryCache(library);
      const report = await runFinish(required(firstArg, "story project path"), {
        library,
        renderer: flags.renderer,
        quality: flags.quality,
        voice: flags.voice,
        music: flags.music,
        musicVolume: flags["music-volume"],
        musicDuck: flags["music-duck"],
        musicPrompt: flags["music-prompt"],
        out: flags.out,
        concurrency: flags.concurrency,
        force: Boolean(flags.force),
        musicRegenerate: Boolean(flags["music-regenerate"]),
        scenes: flags.scene,
        previewScene: flags["preview-scene"],
        chapter: flags.chapter,
        sfxLibrary: flags["sfx-library"],
        sfxDensity: flags["sfx-density"],
        sfx: flags.sfx,
        candidate: flags.candidate,
        prototype: Boolean(flags.prototype),
        animatic: Boolean(flags.animatic),
        planOnly: Boolean(flags["plan-only"]),
        into: flags.into,
        comparison: flags.comparison,
        kind: flags.kind,
        boundary: flags.boundary,
        at: flags.at
      }, productionAdapters.finish).finally(restoreCache);
      throwIfCostLimited(tracker);
      // --review: a vision model reviews the render (the staging review of an
      // animatic, else the critic); --retake: while it does not say ship, the
      // failing shots are retaken and only they render again (src/make/retakes.js).
      const reviewLines = [];
      if ((flags.review || flags.retake) && report.status !== "failed") {
        Object.assign(report, await finishReview(report, flags, { env: productionAdapters.finish?.env ?? process.env, hooks: productionAdapters.finishReview ?? {}, finishAdapters: productionAdapters.finish, say: (line) => stderr.write(`${line}\n`), lines: reviewLines }));
        throwIfCostLimited(tracker);
      }
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatFinishSummary(report)}${reviewLines.map((line) => `${line}\n`).join("")}`);
      if (report.status === "failed") {
        const failedStage = report.stages.find((stage) => stage.status === "failed");
        throw new Error(`launchclip finish failed at the ${failedStage?.name ?? "unknown"} stage: ${failedStage?.error ?? ""}`.trim());
      }
      return;
    } else if (command === "publish-manifest") {
      const { writePublishManifest } = await import("./publish_manifest.js");
      result = await writePublishManifest(required(firstArg, "project path"), { link: flags.link, utm: flags.utm, platforms: flags.platforms });
    } else if (command === "fx") {
      const { runFx, formatFxReport, parseFxTime, readFxParams } = await import("./fx.js");
      const report = await runFx(fxInvocation.video, fxInvocation.module, {
        at: parseFxTime(flags.at, "--at"),
        until: parseFxTime(flags.until, "--until"),
        for: flags.for === undefined ? undefined : Number(flags.for),
        params: await readFxParams(flags.params),
        layer: flags.layer, captions: flags.captions, style: flags.style,
        renderer: flags.renderer, quality: flags.quality, music: flags.music, out: flags.out,
        download: !flags["no-download"]
      }, { log: (line) => stderr.write(`${line}\n`), ...productionAdapters.fx });
      if (!flags.json) {
        stdout.write(formatFxReport(report));
        return;
      }
      result = report;
    } else if (command === "research" && firstArg === "attach") {
      // launchclip research attach <research-dir> [--root .]: evidence data from the captured clips' sidecars.
      const { writeResearchEvidence } = await import("./research/evidence_data.js");
      result = await writeResearchEvidence(researchAttachInvocation.target, { root: flags.root });
    } else if (command === "research" && firstArg === "capture") {
      // launchclip research capture <research-dir> [--root .]: record every capture request, say what could not be recorded, attach.
      const { captureResearch } = await import("./research/record.js");
      result = await captureResearch(researchCaptureInvocation.target, { root: flags.root, command: flags["capture-cmd"], concurrency: flags["capture-concurrency"], media: flags.media }, { log: (line) => stderr.write(`${line}\n`), ...productionAdapters.researchCapture });
    } else if (command === "research") {
      const { runResearch } = await import("./research/index.js");
      result = await runResearch(required(firstArg, "topic or script file"), {
        out: flags.out, urls: flags.url, claims: flags.claims, media: flags.media, people: flags.people,
        maxCaptures: flags["max-captures"], maxTables: flags["max-tables"], theme: flags.theme,
        news: flags.news, feeds: flags.feed, freshDays: flags["fresh-days"]
      }, { log: (line) => stderr.write(`${line}\n`), ...productionAdapters.research });
      // The requests are only requests until recorded: say whether this machine can, and how.
      if (result.summary.captures) {
        const { captureRecorderStatus } = await import("./research/capture_status.js");
        const recorder = await (productionAdapters.captureRecorderStatus ?? captureRecorderStatus)();
        result.captures = { requests: result.summary.captures, recorded: 0, recorder: { available: recorder.available, reasons: recorder.reasons }, next: `launchclip research capture ${flags.out ?? "research"}` };
        stderr.write(recorder.available
          ? `research: ${result.summary.captures} capture request(s) written, none recorded yet; record them with: ${result.captures.next}\n`
          : `research: ${result.summary.captures} capture request(s) written, and this machine cannot record them. ${recorder.hint}\n`);
      }
    } else if (command === "make") {
      const { runMake, formatMakeSummary } = await import("./make/index.js");
      const { makeOptionsFromFlags } = await import("./make/options.js");
      if (!firstArg || firstArg.startsWith("--")) throw new Error("launchclip make needs a prompt: launchclip make \"A 30-second launch video for ...\" [--assets ./assets]");
      if (flags.recipe && !flags.collection) throw new Error("--recipe needs --collection <dir>: launchclip make \"<prompt>\" --collection ./acme --recipe feature-clip");
      const { loadLibrary, useLibraryCache } = await import("./library.js");
      const library = await loadLibrary({ library: flags.library });
      const restoreCache = useLibraryCache(library);
      const makeAdapters = { notice: (line) => stderr.write(`${line}\n`), library, ...productionAdapters.make };
      const report = await (flags.collection
        ? (await import("./collection_cli.js")).makeInCollection(firstArg, flags, makeAdapters)
        : runMake(firstArg, { ...makeOptionsFromFlags(flags), library }, makeAdapters)).finally(restoreCache);
      throwIfCostLimited(tracker);
      // The tracked HTTP costs (actual usage, cache pricing included) join make's own estimates.
      report.api_costs = tracker.summary();
      await (await import("node:fs/promises")).writeFile((await import("node:path")).join(report.project, "MAKE.json"), `${JSON.stringify(report, null, 2)}\n`);
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatMakeSummary(report));
      if (report.status === "failed") throw new Error(`launchclip make failed at the ${report.failed_stage} stage: ${report.stages[report.failed_stage]?.error ?? ""}\nnext: ${report.next_steps[0] ?? ""}`.trim());
      // A rendered video with a failed gate is not a finished one: its own exit code, so a caller can tell it from a failure (1) and from success (0).
      // The animation path also tells awaiting-approval (3) and ready-for-review (4) apart (makeExitCode).
      const exit = makeExitCode(report, { allowNeedsRepair: Boolean(flags["allow-needs-repair"]) });
      if (exit) throw makeStatusError(report, exit);
      return;
    } else if (command === "history") {
      if (historyInvocation.action !== "check") throw new Error(`launchclip history needs an action: launchclip history check <dir> [--json]${historyInvocation.action ? ` (got ${historyInvocation.action})` : ""}`);
      const { checkHistory, formatHistoryCheck } = await import("./visual_history.js");
      const limit = (flag) => flags[flag] === undefined ? undefined : Number(flags[flag]);
      const report = await checkHistory(required(historyInvocation.dir, "history dir"), { hookLimit: limit("hook-limit"), structureLimit: limit("structure-limit"), similarityLimit: limit("similarity-limit") });
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatHistoryCheck(report));
      if (!report.ok) throw new Error(`launchclip history check: ${report.flagged.length} pair(s) too close in ${report.dir}`);
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
    } else if (command === "cutdown") {
      const { runCutdown } = await import("./cutdown.js");
      result = await runCutdown(required(firstArg, "story project path"), flags, productionAdapters.cutdown ?? {});
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
    } else if (scriptCheckInvocation) {
      const { runScriptCheck } = await import("./script_check_cli.js");
      const { formatScriptCheck } = await import("./script_check.js");
      const report = await runScriptCheck(scriptCheckInvocation.file, flags);
      stdout.write(flags.json ? `${JSON.stringify(report, null, 2)}\n` : formatScriptCheck(report, { label: report.source }));
      if (!report.ok) throw new Error(`launchclip script check: ${report.errors.length} error(s) in ${report.source}`);
      return;
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
    // A make that exits on its status (needs-repair and the like) already printed its report, costs included.
    if (!failure.makeStatus) failure.costs = tracker.summary();
    throw failure;
  } finally {
    if (globalThis.fetch === tracker.fetch) globalThis.fetch = previousFetch;
  }
}

/** launchclip make's exit code when the video rendered but a gate failed (MAKE.json status "needs-repair"). */
export const MAKE_NEEDS_REPAIR_EXIT = 2;

/**
 * launchclip make's exit codes by MAKE.json status. Every kind of video: 0,
 * 1 (failed) and 2 (needs-repair). The animation path (routing.kind
 * "animation") also returns 3 and 4 by default, so a host can tell a run
 * that waits for an approval, or for a review no model could give, from a
 * finished one without reading MAKE.json (docs/ANIMATION_PIPELINE_RFC.md §7).
 */
export const MAKE_EXIT_CODES = Object.freeze({ ready: 0, failed: 1, "needs-repair": MAKE_NEEDS_REPAIR_EXIT, "awaiting-approval": 3, "ready-for-review": 4 });
const ANIMATION_ONLY_EXITS = ["awaiting-approval", "ready-for-review"];

/** The exit code for a make report. allowNeedsRepair (--allow-needs-repair): needs-repair exits 0. */
export function makeExitCode(report, { allowNeedsRepair = false } = {}) {
  const status = report?.status;
  if (status === "failed") return MAKE_EXIT_CODES.failed;
  if (status === "needs-repair") return allowNeedsRepair ? 0 : MAKE_EXIT_CODES["needs-repair"];
  // A run stopped after its storyboard (--stop-after storyboard) waits for an approval whatever kind of video it is.
  if (status === "awaiting-approval" && report?.stopped?.after === "storyboard") return MAKE_EXIT_CODES[status];
  if (ANIMATION_ONLY_EXITS.includes(status) && report?.routing?.kind === "animation") return MAKE_EXIT_CODES[status];
  return 0;
}

function makeStatusError(report, exitCode) {
  const failed = Object.entries(report.gates ?? {}).filter(([, gate]) => gate.status === "failed").map(([name]) => name);
  const pending = Object.entries(report.gates ?? {}).filter(([, gate]) => gate.status === "pending").map(([name]) => name);
  const message = report.status === "needs-repair"
    ? `launchclip make: needs-repair (${failed.join(", ") || "a gate"} failed); the video is rendered but not finished. See ${report.project}/MAKE.json. Pass --allow-needs-repair to exit 0.`
    : report.status === "awaiting-approval"
      ? `launchclip make: awaiting-approval${report.stopped?.after ? ` (stopped after ${report.stopped.after})` : ""}; look at what it made, then run it again with --approve. See ${report.project}/MAKE.json.`
      : `launchclip make: ready-for-review (${pending.join(", ") || "a gate"} pending); the video is rendered but nothing reviewed it. See ${report.project}/MAKE.json.`;
  const error = new Error(message);
  error.exitCode = exitCode;
  error.makeStatus = report.status;
  return error;
}

// finish --review / --retake: the review of a finished render, then retakes.
// hooks (tests, a host): {client: {client, provider, model, vision}, critic, redirect, render}.
async function finishReview(report, flags, { env, hooks = {}, finishAdapters = {}, say = () => {}, lines = [] } = {}) {
  const { selectMakeModel, createMakeClient } = await import("./make/models.js");
  const { reviewAnimatic, runHeadlessCritic } = await import("./make/critic.js");
  const { retakeProject, runRetakes } = await import("./make/retakes.js");
  const { criticRepairBudget } = await import("./make/critic_repair.js");
  const project = report.project;
  const staging = Boolean(report.animatic);
  const model = hooks.client ?? createMakeClient(selectMakeModel(flags.model, env).spec);
  if (!model.vision) throw new Error(`launchclip finish --review needs a model that takes images; ${model.provider}:${model.model} does not (launchclip doctor --models says what your keys cover; pass --model provider:model)`);
  const shots = (await retakeProject(project)).shots;
  const quality = report.gates?.coverage?.findings ?? [];
  const critic = hooks.critic ?? ((args) => (staging ? reviewAnimatic : runHeadlessCritic)({ project, client: model.client, model: model.model, provider: model.provider, ...(staging ? {} : { quality }), ...args }));
  say(`model: PAID call to ${model.provider} ${model.model} (${staging ? "staging review of the animatic" : "headless critic"} over qa/critic-sheets/)`);
  const first = await critic({ shots });
  if (first.status !== "written") throw new Error(`launchclip finish --review: the review did not run (${first.reason ?? first.status})`);
  const file = path.relative(project, first.file ?? "") || first.file;
  const review = { status: "written", file, verdict: first.verdict, findings: first.findings, reference_sheets: first.reference_sheets ?? [], warnings: first.warnings ?? [] };
  lines.push(`review: ${first.verdict} (${first.findings} finding${first.findings === 1 ? "" : "s"}; ${file}${review.reference_sheets.length ? `; ${review.reference_sheets.length} reference sheet${review.reference_sheets.length === 1 ? "" : "s"} shown` : ""})`);
  if (!flags.retake) return { review };
  const retakes = await runRetakes({
    project, review: staging ? "animatic" : "final", critique: first.critique, rounds: criticRepairBudget(flags["critic-repairs"]), client: model.client, model: model.model, provider: model.provider,
    finish: { renderer: report.renderer, quality: report.quality, ...(flags.music != null ? { music: flags.music } : {}), ...(flags.voice != null ? { voice: flags.voice } : {}), ...(flags.sfx != null ? { sfx: flags.sfx } : {}), ...(flags.concurrency != null ? { concurrency: flags.concurrency } : {}) },
    finishAdapters, say, critic, ...(hooks.redirect ? { redirect: hooks.redirect } : {}), ...(hooks.render ? { render: hooks.render } : {})
  });
  for (const round of retakes.rounds) lines.push(`retake ${round.round}: ${round.step ?? "none"} ${round.shots.join(", ")}: ${round.kept ? `kept (${round.verdict_before} → ${round.verdict_after}; rendered ${round.rendered.join(", ")})` : `undone (${round.error ?? `no better: ${round.verdict_after}`})`}`);
  lines.push(`retakes: ${retakes.status} after ${retakes.rounds.length} round${retakes.rounds.length === 1 ? "" : "s"} (${path.relative(project, retakes.file)})`);
  return { review: { ...review, verdict: retakes.verdict }, retakes: { file: path.relative(project, retakes.file), status: retakes.status, verdict: retakes.verdict, rounds: retakes.rounds } };
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

function parseLibraryInvocation(action, rest) {
  if (action !== "init") throw new Error(action ? `Unknown library action: ${action}; use init` : "Missing library action; use init");
  const hasTarget = rest[0] && !rest[0].startsWith("--");
  return { action, target: hasTarget ? rest[0] : null, flagArgs: hasTarget ? rest.slice(1) : rest };
}

// launchclip collection new|show <id> [flags]; launchclip recipe new <collection>/<id> [flags]
function parseCollectionInvocation(command, action, rest) {
  const actions = command === "collection" ? ["new", "show"] : ["new"];
  if (!action) throw new Error(`Missing ${command} action; use ${actions.join(" or ")}`);
  if (!actions.includes(action)) throw new Error(`Unknown ${command} action: ${action}; use ${actions.join(" or ")}`);
  const target = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  return { action, target: required(target, command === "recipe" ? "<collection>/<recipe-id>" : "collection id"), flagArgs: rest.slice(1) };
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
  if (!action) throw new Error("Missing story action; use validate, resolve, compile, shots, plan or long-form");
  if (!new Set(["validate", "resolve", "compile", "shots", "plan", "long-form"]).has(action)) throw new Error(`Unknown story action: ${action}`);
  if (action === "plan") return { action, file: null, flagArgs: rest };
  const file = rest[0] && !rest[0].startsWith("--") ? rest[0] : null;
  return { action, file: required(file, action === "compile" || action === "long-form" || action === "shots" ? "story project path" : "story.json path"), flagArgs: rest.slice(1) };
}

async function runStyleCommand(action, name, flags, names = []) {
  const root = flags.root ?? flags["style-root"];
  if (action === "create" && (flags["from-reference"] || flags["from-images"])) {
    return createStyleFromReferences(required(name, "style name"), flags, { root });
  }
  if (action === "upgrade") return upgradeStylePack(required(name, "style name"), { root });
  if (action === "compare") {
    const { compareStyleCommand } = await import("./style_compare.js");
    return compareStyleCommand(required(name, "style name or path"), flags, { root });
  }
  if (["generate", "reroll", "keep", "pin", "preview", "distance"].includes(action)) {
    const { styleDistanceCommand, styleGenerateCommand, styleKeepCommand, stylePinCommand, stylePreviewCommand, styleRerollCommand } = await import("./style_seed_store.js");
    if (action === "generate") return styleGenerateCommand(flags);
    if (action === "reroll") return styleRerollCommand(name, flags);
    if (action === "pin") return stylePinCommand(name, flags);
    if (action === "preview") return stylePreviewCommand(required(name, "style (style.json, project or name)"), flags);
    if (action === "distance") return styleDistanceCommand(names);
    return styleKeepCommand(required(name, "project path"), flags);
  }
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

function parseCastInvocation(action, rest) {
  const actions = ["list", "show", "sheet", "create", "edit", "options", "export", "import", "sprites"];
  if (!action) throw new Error(`Missing cast action; use ${actions.slice(0, -1).join(", ")} or sprites`);
  if (!actions.includes(action)) throw new Error(`Unknown cast action: ${action}; use ${actions.slice(0, -1).join(", ")} or sprites`);
  // export takes every leading id: launchclip cast export nova rae --out pack
  const leading = rest.findIndex((token) => token.startsWith("--"));
  const names = action === "export" ? rest.slice(0, leading < 0 ? rest.length : leading) : [];
  const hasName = rest[0] && !rest[0].startsWith("--");
  return { action, name: hasName ? rest[0] : null, names, flagArgs: action === "export" ? rest.slice(names.length) : hasName ? rest.slice(1) : rest };
}

function parseStyleInvocation(action, rest) {
  if (!action) throw new Error("Missing style action; use create, save, list, show, upgrade, check, compare, generate, reroll, keep, pin, preview or distance");
  if (!new Set(["create", "save", "list", "show", "upgrade", "check", "compare", "generate", "reroll", "keep", "pin", "preview", "distance"]).has(action)) throw new Error(`Unknown style action: ${action}`);
  const takesName = action !== "list" && action !== "generate";
  // distance takes every leading style: launchclip style distance a b c
  const leading = rest.findIndex((token) => token.startsWith("--"));
  const names = action === "distance" ? rest.slice(0, leading < 0 ? rest.length : leading) : [];
  const hasName = takesName && rest[0] && !rest[0].startsWith("--");
  const flagArgs = action === "distance" ? rest.slice(names.length) : hasName ? rest.slice(1) : rest;
  // --from-reference a.mp4 b.mp4 / --from-images x.png y.png take several files.
  const expanded = [];
  let multi = null;
  for (const token of flagArgs) {
    if (token.startsWith("--")) { multi = ["--from-reference", "--from-images", "--font-hint"].includes(token) ? token : null; expanded.push(token); continue; }
    if (multi && expanded.at(-1) !== multi) expanded.push(multi);
    expanded.push(token);
  }
  return { action, name: hasName ? rest[0] : null, names, flagArgs: expanded };
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
    // make --approve bible names what is approved; elsewhere --approve is a switch.
    if (name === "approve" && /^(bible|animatic|storyboard)(,(bible|animatic|storyboard))*$/.test(args[index + 1] ?? "")) {
      flags[name] = args[index + 1];
      index += 1;
      continue;
    }
    if (name === "keep-fillers" || name === "no-audio-silence" || name === "edit-recording" || name === "dry-run" || name === "submit" || name === "no-render" || name === "force" || name === "approve" || name === "review" || name === "critic-pro" || name === "transcribe-all" || name === "allow-placeholder-sfx" || name === "allow-frame-fallback" || name === "repair-text-only" || name === "repair-scoped-source" || name === "refresh-free-models" || name === "no-music" || name === "no-voice" || name === "no-sfx" || name === "no-audio" || name === "no-open" || name === "allow-timing-drift" || name === "foreground" || name === "fast-eval" || name === "no-trim-silence" || name === "skip-quality-gates" || name === "skip-hyperframes-quality" || name === "strict" || name === "strict-all" || name === "pro" || name === "expect-audio" || name === "json" || name === "absolute" || name === "undo" || name === "music-regenerate" || name === "missing" || name === "no-seed" || name === "no-start" || name === "plan-only" || name === "headed" || name === "reject" || name === "replan" || name === "allow-needs-repair" || name === "critic" || name === "no-critic" || name === "approve-demo" || name === "base-edited" || name === "redemo" || name === "no-download" || name === "no-subject" || name === "face-track" || name === "no-direction" || name === "prototype" || name === "overshoot" || name === "off" || name === "refresh-free-vision-models" || name === "capacity" || name === "still" || name === "models" || name === "no-sheet" || name === "no-pin" || name === "animatic" || name === "retake") {
      flags[name] = true;
      continue;
    }
    // make --animation and make --refine are switches too.
    if (name === "animation" || name === "refine") {
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
