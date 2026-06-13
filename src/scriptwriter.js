// The script-writer: an LLM drafts a short-form voiceover script from a brief,
// guided by patterns distilled from high-performing AI-tool explainer Shorts
// (see the viral-scripts corpus). Output matches voiceover.json so the
// existing `launchclip script` can format the teleprompter and `direct` can
// build the motion timeline from it. Provider/key handling is shared with the
// Director (Anthropic default, OpenAI fallback).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { makeDirectorClient } from "./director.js";

// Distilled from viral-scripts/INSIGHTS.md — the shape a good short-form
// script takes. Kept in code so the writer is self-contained (no runtime
// dependency on the research repo).
export const VIRAL_SCRIPT_GUIDE = `You write short-form video scripts (YouTube Shorts / Reels / TikTok) in the style of high-performing AI-tool explainers. Follow these patterns exactly.

LENGTH & PACE: 40-55 seconds, 130-165 words total, fast and energetic. One short clause per breath — every sentence is its own beat.

STRUCTURE (always this skeleton):
1. HOOK — one line, <=14 words, earns the next 3 seconds. Use ONE of: contrarian/"shocking" observation; outcome + number + timeframe; rhetorical challenge / loss-aversion; conditional promise that names the audience ("If you..."); mistake call-out ("Everyone does X wrong"); news + analogy ("X, basically Y but for Z"); or free/now/forever. Never start with "In this video" or any preamble.
2. TURN — one bridge line ("Here's what to do instead." / "Here's the setup." / "Turns out...").
3. BODY — 3 to 5 NUMBERED steps signalled out loud ("First... Then... Next... Finally"). One imperative sentence per step (lead with a verb). Every step names a real, concrete thing (a tool, file, command, API) and, where possible, one vivid concrete example. Escalate toward the biggest payoff.
4. PAYOFF — one line that lands the transformation: name the concept, compress before->after ("turn a 4-hour task into one instruction"), use a rule-of-three, or restate the hook delivered.
5. CTA — optional, one line, soft.

SPECIFICITY IS THE WHOLE GAME: pack in real names and real numbers. Vague benefits ("powerful", "saves time") are forbidden. CRITICAL: use ONLY facts, names, and numbers present in the brief. NEVER invent metrics, tool names, or claims — fabrication destroys trust.

TONE: second person, present tense, confident, plain-spoken. No hedging, no hype adjectives without proof, no filler.

Return ONLY a JSON object:
{
  "delivery": "short phrase describing the read (e.g. 'fast, plain-spoken, confident')",
  "hook_type": "which hook pattern you used",
  "segments": [ {"beat": "hook|turn|step-1|step-2|...|payoff|cta", "text": "the spoken line"} ],
  "notes": "one sentence on the angle you chose"
}
Each segment.text is exactly what the presenter says. Keep beats in spoken order.`;

function parseJsonLoose(text) {
  let candidate = String(text).trim();
  if (candidate.startsWith("```")) candidate = candidate.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object in script-writer response");
    return JSON.parse(candidate.slice(start, end + 1));
  }
}

// Build the brief the writer reasons over: an explicit --brief wins; otherwise
// assemble real facts from the workspace manifest (so nothing is fabricated).
async function resolveBrief(out, flags) {
  if (flags.brief) return flags.brief;
  const manifestPath = path.join(out, "launchclip.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const repo = manifest.source_repo ?? {};
    const facts = [
      repo.name ? `Project: ${repo.name}` : "",
      repo.summary ? `Summary: ${repo.summary}` : "",
      repo.description ? `Description: ${repo.description}` : "",
      Array.isArray(repo.proof_points) ? `Proof points: ${repo.proof_points.join("; ")}` : ""
    ].filter(Boolean).join("\n");
    if (facts) return facts;
  }
  throw new Error("No --brief and no usable facts in launchclip.json. Pass --brief \"...\".");
}

export async function writeScriptDraft(out, flags = {}) {
  const log = (message) => process.stderr.write(`[write-script] ${message}\n`);
  const brief = await resolveBrief(out, flags);
  const topic = flags.topic ?? "";
  const audience = flags.audience ?? "people who'd use this tool";
  const duration = Number(flags.duration ?? 45);

  const client = await makeDirectorClient(flags, log);
  const userPrompt = [
    topic ? `TOPIC: ${topic}` : "",
    `AUDIENCE: ${audience}`,
    `TARGET LENGTH: ~${duration}s (${Math.round((duration / 60) * 150)} words at 150 wpm; stay 130-165 words).`,
    `BRIEF — the ONLY facts/names/numbers you may use (never invent others):\n${brief}`,
    `Write the script now as the JSON object specified.`
  ].filter(Boolean).join("\n\n");

  log("drafting script");
  const response = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8", // OpenAI shim ignores this and uses its own model
    max_tokens: 2000,
    system: VIRAL_SCRIPT_GUIDE,
    messages: [{ role: "user", content: userPrompt }]
  });
  const text = response.content.find((block) => block.type === "text")?.text;
  if (!text) throw new Error("script-writer returned no text");
  const draft = parseJsonLoose(text);

  const segments = (draft.segments ?? []).map((segment) => ({
    beat: String(segment.beat ?? "segment"),
    text: String(segment.text ?? "").trim()
  })).filter((segment) => segment.text);
  if (!segments.length) throw new Error("script-writer produced no segments");
  const fullText = segments.map((segment) => segment.text).join(" ");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  const voiceover = {
    provider: "script-writer",
    delivery: draft.delivery ?? "fast, plain-spoken, confident",
    hook_type: draft.hook_type ?? null,
    notes: draft.notes ?? null,
    word_count: wordCount,
    segments,
    full_text: fullText
  };

  await mkdir(path.join(out, "video"), { recursive: true });
  const voiceoverPath = path.join(out, "video", "voiceover.json");
  await writeFile(voiceoverPath, `${JSON.stringify(voiceover, null, 2)}\n`);
  log(`script: ${segments.length} beats, ${wordCount} words`);

  return {
    stage: "write-script",
    voiceover: voiceoverPath,
    beats: segments.length,
    word_count: wordCount,
    hook_type: voiceover.hook_type,
    full_text: fullText
  };
}
