import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildTeleprompterMarkdown } from "./talking_head.js";

export const VIRAL_SCRIPT_SCHEMA = "launchclip.viral-script.v1";
const TARGET_WPM = 185;

export async function writeViralScript(workspacePath, flags = {}) {
  const out = path.resolve(workspacePath);
  const evidence = await readEvidenceBank(out, flags);
  const script = buildViralScript(evidence, flags);
  const voiceover = buildVoiceoverFromViralScript(script);
  const videoDir = path.join(out, "video");
  await mkdir(videoDir, { recursive: true });
  const scriptPath = path.join(videoDir, "script.json");
  const voiceoverPath = path.join(videoDir, "voiceover.json");
  const teleprompterPath = path.join(videoDir, "teleprompter.md");
  await writeJson(scriptPath, script);
  await writeJson(voiceoverPath, voiceover);
  await writeFile(teleprompterPath, buildTeleprompterMarkdown(voiceover, TARGET_WPM));
  return {
    stage: "script",
    status: "written",
    script: scriptPath,
    voiceover: voiceoverPath,
    teleprompter: teleprompterPath,
    word_count: script.word_count,
    target_seconds: script.target_seconds
  };
}

export async function readEvidenceBank(out, flags = {}) {
  const manifest = await optionalJson(path.join(out, "launchclip.json"));
  const terminal = await optionalText(path.join(out, "demo", "terminal.txt"));
  const receipt = await optionalJson(path.join(out, "demo", "command-receipt.json"));
  const source = manifest?.source_repo ?? {};
  const repoName = cleanName(source.name) || "this repo";
  const summary = cleanSentence(source.summary || source.package?.description || "turns a working demo into launch proof");
  const command = cleanCommand(receipt?.command || firstTerminalCommand(terminal) || "launchclip run <repo>");
  const artifacts = [
    ...(receipt?.artifacts ?? []).map((artifact) => artifact.path).filter(Boolean),
    "video/script.json",
    "video/motion-timeline.json",
    "captions/*.md",
    "REVIEW.md"
  ];
  return {
    repoName,
    summary,
    command,
    demoStatus: receipt?.status ?? (terminal ? "captured" : "unknown"),
    terminal: terminal ?? "",
    prompt: String(flags.prompt ?? flags.angle ?? "").trim(),
    artifacts: [...new Set(artifacts)]
  };
}

export function buildViralScript(evidence, flags = {}) {
  const repoName = cleanName(evidence.repoName) || "this repo";
  const command = cleanCommand(evidence.command) || "launchclip run <repo>";
  const summary = cleanSentence(evidence.summary || "turns a working demo into launch proof");
  const promptHint = cleanSentence(evidence.prompt || "make the launch packet reviewable");
  const primaryArtifact = evidence.artifacts?.[0] ?? "demo/terminal.txt";
  const beats = [
    {
      beat: "hook",
      role: "hook",
      text: "Your working repo is already the launch video when the proof is visible."
    },
    {
      beat: "turn",
      role: "turn",
      text: "The move is turning evidence into a story before you touch an editor."
    },
    {
      beat: "first",
      role: "step",
      text: `First, run ${command} and capture the terminal receipt, because passing output beats a promise.`
    },
    {
      beat: "then-context",
      role: "step",
      text: `Then, pull the README, package metadata, and demo result into one evidence bank so every claim has a source.`
    },
    {
      beat: "next-packet",
      role: "step",
      text: `Next, write the teleprompter around the strongest concrete moment: the command runs, the artifact appears, the proof is inspectable.`
    },
    {
      beat: "then-voice",
      role: "step",
      text: "Then, sync TTS or a presenter take to motion beats, so every card lands on the word that names it."
    },
    {
      beat: "finally-review",
      role: "step",
      text: "Finally, render the MP4, thumbnail, captions, timeline, and review packet as one approval-ready launch packet."
    },
    {
      beat: "payoff",
      role: "payoff",
      text: "That is proof-led launch content: the demo sells, the script explains, and the review packet keeps it honest."
    },
    {
      beat: "cta",
      role: "cta",
      text: `Point Launchclip at ${repoName} when ${promptHint}, then approve the cut.`
    }
  ];
  const fullText = beats.map((beat) => beat.text).join(" ");
  const wordCount = countWords(fullText);
  const visualBeats = beats.map((beat) => visualBeatFor(beat, { command, primaryArtifact, repoName, summary }));
  return {
    schema_version: VIRAL_SCRIPT_SCHEMA,
    strategy: "reference-grade short-form script: hook, turn, named steps, concrete visual nouns, proof-backed payoff",
    target_wpm: TARGET_WPM,
    target_seconds: Math.round((wordCount / TARGET_WPM) * 600) / 10,
    word_count: wordCount,
    source_policy: "Use only repo metadata, demo evidence, generated artifact names, and user prompt context; do not invent metrics.",
    evidence,
    beats,
    visual_beats: visualBeats,
    music_prompt: buildMusicPrompt({ repoName, summary }),
    full_text: fullText,
    quality_gates: [
      "hook is one line and under fourteen words",
      "script is between 130 and 165 words",
      "body has three to five numbered spoken steps",
      "numbers and tool names come from evidence",
      "every beat names a concrete visual object or has a fallback visual",
      "visuals must map to spoken nouns; never use unrelated screenshots as proof"
    ],
    warnings: qualityWarnings(beats, fullText, visualBeats)
  };
}

export function buildVoiceoverFromViralScript(script) {
  let cursor = 0;
  const segments = script.beats.map((beat, index) => {
    const words = countWords(beat.text);
    const seconds = Math.max(1.8, Math.round((words / script.target_wpm) * 600) / 10);
    const start = Math.round(cursor * 10) / 10;
    cursor += seconds;
    const end = Math.round(cursor * 10) / 10;
    return {
      index: index + 1,
      beat: beat.beat,
      role: beat.role,
      time_range: `${start}-${end}s`,
      start_seconds: start,
      end_seconds: end,
      target_seconds: seconds,
      text: beat.text,
      delivery: deliveryForRole(beat.role),
      pause_after_ms: beat.role === "cta" ? 0 : 90
    };
  });
  return {
    schema_version: "launchclip.voiceover.v1",
    provider: "script-ready",
    delivery: "fast, second-person, present-tense, proof-led, one breath per beat",
    pacing: `${script.target_wpm} words per minute target`,
    full_text: script.full_text,
    segments,
    renderer_notes: [
      "Use the same script for recorded presenter takes and TTS.",
      "Align motion builds to word timings after the take or TTS is available.",
      "Keep visual text short; the voice carries the detail."
    ]
  };
}

export function countWords(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

function visualBeatFor(beat, { command, primaryArtifact, repoName, summary }) {
  const common = {
    beat: beat.beat,
    role: beat.role,
    spoken_anchor: beat.text,
    forbidden: ["generic stock screenshot", "unrelated app UI", "unclaimed metric"]
  };
  if (beat.beat === "hook") {
    return {
      ...common,
      scene_hint: "talking_head or typography",
      visual_goal: "show the repo becoming the subject, not a generic product pitch",
      on_screen_text: ["working repo", "launch video", "visible proof"],
      required_source: "repo metadata or generated repo card",
      fallback_visual: "typography with repo/proof keywords"
    };
  }
  if (beat.beat === "turn") {
    return {
      ...common,
      scene_hint: "typography",
      visual_goal: "bridge from manual editing to evidence-to-story automation",
      on_screen_text: ["evidence", "story", "editor"],
      required_source: "none",
      fallback_visual: "kinetic typography"
    };
  }
  if (beat.beat === "first") {
    return {
      ...common,
      scene_hint: "terminal_receipt or prompt_card",
      visual_goal: "show the exact demo command and real terminal pass receipt",
      on_screen_text: [command, "terminal receipt", "passed"],
      required_source: "demo/terminal.txt or demo/command-receipt.json",
      fallback_visual: "terminal_receipt generated from captured command"
    };
  }
  if (beat.beat === "then-context") {
    return {
      ...common,
      scene_hint: "artifact_grid or card_steps",
      visual_goal: "show README/package/demo evidence feeding a claim bank",
      on_screen_text: ["README", "package", "demo result", repoName],
      required_source: "launchclip.json source_repo, README/package metadata",
      fallback_visual: "metadata cards generated from workspace evidence"
    };
  }
  if (beat.beat === "next-packet") {
    return {
      ...common,
      scene_hint: "artifact_grid",
      visual_goal: "show the concrete output files that become the short",
      on_screen_text: [primaryArtifact, "teleprompter", "captions", "review packet"],
      required_source: "generated video/script.json, captions, review artifacts",
      fallback_visual: "artifact_grid with generated artifact names"
    };
  }
  if (beat.beat === "then-voice") {
    return {
      ...common,
      scene_hint: "funnel or card_steps",
      visual_goal: "show voice or presenter syncing to word-timed motion",
      on_screen_text: ["TTS", "presenter take", "word-timed cards"],
      required_source: "voiceover words or presenter alignment",
      fallback_visual: "word timing cards and waveform-style labels"
    };
  }
  if (beat.beat === "finally-review") {
    return {
      ...common,
      scene_hint: "artifact_grid",
      visual_goal: "show the approval packet as concrete deliverables",
      on_screen_text: ["MP4", "thumbnail", "captions", "timeline", "review packet"],
      required_source: "generated video artifacts",
      fallback_visual: "artifact_grid generated from expected output paths"
    };
  }
  if (beat.beat === "payoff") {
    return {
      ...common,
      scene_hint: "typography or card_steps",
      visual_goal: "land the proof-led content concept as a memorable reframe",
      on_screen_text: ["demo sells", "script explains", "review keeps it honest"],
      required_source: "none",
      fallback_visual: "rule-of-three typography"
    };
  }
  return {
    ...common,
    scene_hint: "talking_head or typography",
    visual_goal: `make the approval-safe CTA specific to ${repoName}`,
    on_screen_text: ["Point Launchclip", repoName, "approve the cut"],
    required_source: "repo name from evidence",
    fallback_visual: "CTA typography over presenter or paper background"
  };
}

function buildMusicPrompt({ repoName, summary }) {
  return [
    "Retro 80s synthwave and computer-game product-demo energy.",
    "Fast but clean instrumental bed under a spoken tech voiceover:",
    "analog arpeggios, warm pulsing bass, crisp drum machine, playful UI blips, no vocals.",
    `The video is about ${repoName} and ${summary}; make it feel like a useful tool discovery, not a cinematic trailer.`
  ].join(" ");
}

function qualityWarnings(beats, fullText, visualBeats = []) {
  const warnings = [];
  const hookWords = countWords(beats[0]?.text);
  const wordCount = countWords(fullText);
  const stepCount = beats.filter((beat) => beat.role === "step").length;
  if (hookWords > 14) warnings.push(`hook is ${hookWords} words; target is 14 or fewer`);
  if (wordCount < 130 || wordCount > 165) warnings.push(`script is ${wordCount} words; target is 130-165`);
  if (stepCount < 3 || stepCount > 5) warnings.push(`script has ${stepCount} steps; target is 3-5`);
  if (visualBeats.length !== beats.length) warnings.push("every script beat needs a matching visual beat");
  for (const visual of visualBeats) {
    if (!visual.on_screen_text?.length) warnings.push(`visual beat "${visual.beat}" has no on-screen text anchors`);
    if (!visual.fallback_visual) warnings.push(`visual beat "${visual.beat}" has no fallback visual`);
  }
  return warnings;
}

function deliveryForRole(role) {
  if (role === "hook") return "fast pattern interrupt, one breath";
  if (role === "turn") return "bridge into the mechanism";
  if (role === "step") return "imperative, concrete, keep momentum";
  if (role === "payoff") return "confident reframe, emotional peak";
  return "short approval-safe CTA";
}

async function optionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function optionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanSentence(value) {
  return String(value ?? "")
    .replace(/[#*_`>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function cleanCommand(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function firstTerminalCommand(terminal) {
  const line = String(terminal ?? "").split("\n").find((entry) => entry.trim().startsWith("$ "));
  return line ? line.trim().slice(2) : "";
}
