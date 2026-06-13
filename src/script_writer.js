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
      text: "If your repo works, it should not need a second launch workflow."
    },
    {
      beat: "turn",
      role: "turn",
      text: "Here is the setup that makes the launch proof build itself."
    },
    {
      beat: "first",
      role: "step",
      text: `First, run ${command} so Launchclip captures the real terminal receipt instead of a promise.`
    },
    {
      beat: "then-context",
      role: "step",
      text: `Then, use the README and package metadata to explain that ${repoName} ${summary}.`
    },
    {
      beat: "next-packet",
      role: "step",
      text: `Next, turn ${primaryArtifact} into a teleprompter script, matched visual beats, captions, and a review packet.`
    },
    {
      beat: "then-voice",
      role: "step",
      text: "Then, hand it a presenter take or TTS voice, and align every motion build to the spoken words."
    },
    {
      beat: "finally-review",
      role: "step",
      text: "Finally, review the packet before anything posts, because the claims should match the proof."
    },
    {
      beat: "payoff",
      role: "payoff",
      text: `That is the shift: ${repoName} stops asking for launch content and starts packaging its own evidence.`
    },
    {
      beat: "cta",
      role: "cta",
      text: `Try Launchclip when ${promptHint}, then swap in better assets before approval.`
    }
  ];
  const fullText = beats.map((beat) => beat.text).join(" ");
  const wordCount = countWords(fullText);
  return {
    schema_version: VIRAL_SCRIPT_SCHEMA,
    strategy: "reference-grade short-form script: hook, turn, named steps, proof-backed payoff",
    target_wpm: TARGET_WPM,
    target_seconds: Math.round((wordCount / TARGET_WPM) * 600) / 10,
    word_count: wordCount,
    source_policy: "Use only repo metadata, demo evidence, generated artifact names, and user prompt context; do not invent metrics.",
    evidence,
    beats,
    full_text: fullText,
    quality_gates: [
      "hook is one line and under fourteen words",
      "script is between 130 and 165 words",
      "body has three to five numbered spoken steps",
      "numbers and tool names come from evidence"
    ],
    warnings: qualityWarnings(beats, fullText)
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

function qualityWarnings(beats, fullText) {
  const warnings = [];
  const hookWords = countWords(beats[0]?.text);
  const wordCount = countWords(fullText);
  const stepCount = beats.filter((beat) => beat.role === "step").length;
  if (hookWords > 14) warnings.push(`hook is ${hookWords} words; target is 14 or fewer`);
  if (wordCount < 130 || wordCount > 165) warnings.push(`script is ${wordCount} words; target is 130-165`);
  if (stepCount < 3 || stepCount > 5) warnings.push(`script has ${stepCount} steps; target is 3-5`);
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
