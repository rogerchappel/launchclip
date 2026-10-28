// @launchclip/engine: LaunchClip's Node engine for apps that embed it. One
// createEngine() call binds a working directory, a state/cache folder and the
// app's adapters (models, voice, music, transcription, matting, media); every
// method then runs the same code the CLI runs, with each model and provider
// call going through those adapters (the CLI's implementations by default)
// and every piece of state kept under the app's folders (src/state_dirs.js).
// The adapter interfaces are documented in src/engine/adapters.js and in
// packages/engine/README.md (the @launchclip/engine package).
import path from "node:path";
import { withStateDirs } from "../state_dirs.js";
import { engineAdapters } from "./adapters.js";

export { ADAPTER_KEYS, defaultEngineAdapters, engineAdapters } from "./adapters.js";
export { withStateDirs } from "../state_dirs.js";

// Pure functions an app can call without an engine: the recording edit plan
// and the gates read only their arguments (and the project files they name).
export { normalizeRecordingTranscript, planRecordingEdit } from "../recording_edit.js";
export { coverageGate, directionGate, faceGate, gateProfile, prototypeCut, prototypeScope, qualityFindings, readProjectDirection } from "../quality_gates.js";
export { checkStoryboard } from "../storyboard_planner.js";
export { FINISH_STAGES, formatFinishSummary } from "../finish.js";

/**
 * options: {
 *   workDir: folder every project path is resolved against (and must stay
 *     inside); projects keep their own .launchclip/ working state,
 *   cacheDir: caches that outlive a project (voice, music, Kokoro models),
 *   stateDir: user state LaunchClip would keep in ~/.launchclip (styles,
 *     skeletons, the SFX library, matting models, the slot queue); default
 *     <cacheDir>/state,
 *   adapters: any of src/engine/adapters.js ADAPTER_KEYS,
 *   env: environment the default providers read (API keys, and
 *     LAUNCHCLIP_REMOTION_BROWSER: the Chrome the default Remotion renderer
 *     uses); default {}, so nothing in the app's process.env reaches a
 *     default provider unless the app passes it
 * }
 */
export function createEngine(options = {}) {
  if (!options.workDir) throw new Error("createEngine needs workDir");
  if (!options.cacheDir) throw new Error("createEngine needs cacheDir");
  const workDir = path.resolve(options.workDir);
  const cacheDir = path.resolve(options.cacheDir);
  const stateDir = path.resolve(options.stateDir ?? path.join(cacheDir, "state"));
  const env = { ...(options.env ?? {}) };
  const adapters = engineAdapters(options.adapters, { env });
  const run = (fn) => withStateDirs({ home: stateDir, cache: cacheDir }, fn);

  /** A project folder inside workDir (relative paths resolve against it). */
  function project(name = ".") {
    const resolved = path.resolve(workDir, String(name));
    const relative = path.relative(workDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${resolved} is outside the engine's workDir ${workDir}`);
    return resolved;
  }

  return Object.freeze({
    workDir,
    cacheDir,
    stateDir,
    adapters,
    project,

    /**
     * src/storyboard_planner.js planStoryboard with the llm adapter as its
     * client, plus the assets adapter (the asset-provider hook) when given.
     * planOptions.project: the project (inside workDir) shot files are copied
     * into.
     */
    planStoryboard(planOptions = {}) {
      return run(async () => {
        const { planStoryboard } = await import("../storyboard_planner.js");
        return planStoryboard({ ...planOptions, project: planOptions.project ? project(planOptions.project) : null, client: planOptions.client ?? adapters.llm(), assets: planOptions.assets ?? adapters.assets ?? null });
      });
    },

    /**
     * src/finish.js runFinish on a project: voice, music, SFX, the mix, the
     * master, evidence and the gates. overrides: any finish adapter.
     */
    finish(projectName, finishOptions = {}, overrides = {}) {
      return run(async () => {
        const { runFinish } = await import("../finish.js");
        return runFinish(project(projectName), finishOptions, { ...adapters.finish(), ...overrides });
      });
    },

    /** src/render_segments.js renderWithSegments, with the renderer adapter. */
    renderSegments(renderOptions = {}) {
      return run(async () => {
        const { renderWithSegments } = await import("../render_segments.js");
        const dir = project(renderOptions.project ?? ".");
        const renderer = renderOptions.renderer ?? "remotion";
        return renderWithSegments({ ...renderOptions, project: dir, renderer, adapter: renderOptions.adapter ?? adapters.renderer(renderer) });
      });
    },

    /** src/nle/export.js runExport: FCPXML / OTIO / EDL with overlay plates. */
    exportNle(projectName, exportOptions = {}, overrides = {}) {
      return run(async () => {
        const { runExport } = await import("../nle/export.js");
        return runExport(project(projectName), exportOptions, overrides);
      });
    },

    /** The headless vision critic (src/make/critic.js) on a finished project, with the llm adapter. */
    critique(projectName, criticOptions = {}) {
      return run(async () => {
        const { runHeadlessCritic } = await import("../make/critic.js");
        const client = criticOptions.client ?? adapters.llm({ vision: true });
        return runHeadlessCritic({ ...criticOptions, project: project(projectName), client });
      });
    },

    /**
     * The footage-led lane: src/recording_workflow.js prepareRecording
     * (transcribe, retakes, pauses, audio clean-up) with the transcribe
     * adapter. input and options.out are resolved inside workDir.
     */
    prepareRecording(input, recordingOptions = {}, overrides = {}) {
      return run(async () => {
        const { prepareRecording } = await import("../recording_workflow.js");
        const out = recordingOptions.out ? project(recordingOptions.out) : recordingOptions.out;
        return prepareRecording(project(input), { ...recordingOptions, out }, { ...adapters.recording(), ...overrides });
      });
    },

    /** The subject layer (src/subject/stage.js) with the matting adapter: probe, track and matte a recording. */
    subject: Object.freeze({
      probe: (src, subjectOptions = {}) => subjectStage("runSubjectProbe", [project(src)], subjectOptions),
      track: (src, subjectOptions = {}) => subjectStage("runSubjectTrack", [project(src)], subjectOptions),
      matte: (src, range, subjectOptions = {}) => subjectStage("runSubjectMatte", [project(src), range], subjectOptions)
    })
  });

  function subjectStage(name, args, subjectOptions) {
    return run(async () => {
      const stage = await import("../subject/stage.js");
      // The matte cache sits in the project tree, never under the process cwd.
      const cacheDir = subjectOptions.cacheDir ? project(subjectOptions.cacheDir) : path.join(workDir, ".launchclip", "subject");
      return stage[name](...args, { ...subjectOptions, cacheDir, createSegmenter: subjectOptions.createSegmenter ?? adapters.matting ?? undefined });
    });
  }
}
