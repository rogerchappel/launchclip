import { readFile } from "node:fs/promises";
import path from "node:path";
import { collectEvidence } from "./evidence.js";
import { directFrames } from "./frame_director.js";
import { assembleHyperFrames } from "./hyperframes_assembler.js";
import { writeIntake } from "./intake.js";
import { planProduction } from "./creative_planner.js";
import { produceAudio } from "./production_audio.js";

export async function runProductionStage(command, target, flags = {}, adapters = {}) {
  if (command === "evidence") return collectEvidence(target, evidenceOptions(flags), adapters.evidence);
  if (command === "creative-plan") return planProduction(target, plannerOptions(flags), adapters.planner);
  if (command === "direct-frames") return directFrames(target, frameOptions(flags), adapters.frames);
  if (command === "production-audio") return produceAudio(target, audioOptions(flags), adapters.audio);
  if (command === "assemble") return assembleWithProducedAudio(target, flags);
  if (command !== "produce") throw new Error(`Unknown production stage: ${command}`);
  return runProduction(target, flags, adapters);
}

export async function runProduction(source, flags = {}, adapters = {}) {
  const intake = await (adapters.writeIntake ?? writeIntake)(source, flags);
  const workspace = intake.workspace;
  const evidence = await (adapters.collectEvidence ?? collectEvidence)(workspace, evidenceOptions(flags), adapters.evidence);
  const plan = await (adapters.planProduction ?? planProduction)(workspace, plannerOptions(flags), adapters.planner);
  const noAudio = Boolean(flags["no-audio"]);
  const audio = await (adapters.produceAudio ?? produceAudio)(workspace, {
    ...audioOptions(flags),
    noVoice: noAudio || Boolean(flags["no-voice"]),
    noMusic: noAudio || Boolean(flags["no-music"]),
    noSfx: noAudio || Boolean(flags["no-sfx"])
  }, adapters.audio);
  if (audio.status === "needs-retiming" && !flags["allow-timing-drift"]) {
    throw new Error(`${audio.warnings.join(" ")} Re-run creative planning with measured narration timing, or pass --allow-timing-drift to inspect the draft.`);
  }
  const frames = await (adapters.directFrames ?? directFrames)(workspace, frameOptions(flags), adapters.frames);
  const assembly = await (adapters.assembleHyperFrames ?? assembleHyperFrames)(workspace, {
    voiceover: audio.voiceover,
    music: audio.music,
    sfxManifest: audio.sfx,
    musicVolume: numberOr(flags["music-volume"], 0.16)
  });
  return {
    stage: "produce",
    status: "awaiting-approval",
    workspace,
    evidence,
    plan,
    audio,
    frames: { generated: frames.generated, cached: frames.cached },
    assembly,
    next: `Review ${assembly.index}, then run launchclip production-render ${workspace} when approved.`
  };
}

async function assembleWithProducedAudio(workspace, flags) {
  let audio = null;
  try {
    audio = JSON.parse(await readFile(path.join(path.resolve(workspace), "production", "media", "manifest.json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return assembleHyperFrames(workspace, {
    voiceover: audio?.voiceover?.path,
    music: audio?.music?.path,
    sfxManifest: audio?.sfx_manifest,
    musicVolume: numberOr(flags["music-volume"], 0.16)
  });
}

function evidenceOptions(flags) {
  return { maxItemChars: numberOr(flags["max-evidence-chars"], 60_000) };
}

function plannerOptions(flags) {
  return {
    background: !flags.foreground,
    maxOutputTokens: numberOr(flags["max-output-tokens"], 48_000),
    maxAttempts: numberOr(flags["max-attempts"], 3)
  };
}

function frameOptions(flags) {
  return {
    background: !flags.foreground,
    concurrency: numberOr(flags.concurrency, 4),
    semanticAttempts: numberOr(flags["semantic-attempts"], 2),
    reasoning: flags["frame-reasoning"] ?? "high"
  };
}

function audioOptions(flags) {
  return {
    noVoice: Boolean(flags["no-voice"]),
    noMusic: Boolean(flags["no-music"]),
    noSfx: Boolean(flags["no-sfx"]),
    voiceId: flags["voice-id"],
    voiceModel: flags["voice-model"],
    musicModel: flags["music-model"],
    sfxDir: flags["sfx-dir"],
    words: flags.words
  };
}

function numberOr(value, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Expected a positive number, received ${value}`);
  return number;
}
