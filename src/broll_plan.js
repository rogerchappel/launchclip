/** Offline capture suggestions. These identify spoken topics, not verified proof. */
export const BROLL_PLAN_SCHEMA_VERSION = "launchclip.broll-plan.v1";

const RULES = [
  { key: "challenge", match: /\b(challenge|seven.day|7.day)\b/i, priority: "high", description: "Show your real first-build checklist", action: "Open your own challenge or build checklist. Slowly check one real completed step; leave unfinished steps visibly unfinished." },
  { key: "community", match: /\b(community|shipmates|members|together)\b/i, priority: "medium", description: "Show a community progress update", action: "Record your own community welcome or progress post. Use a demo account or your own post; hide member names, avatars and private messages." },
  { key: "agent", match: /\b(agents?|hands.free|automations?)\b/i, priority: "high", description: "Show an agent completing a small real task", action: "Use a sandbox agent session with a harmless task, such as creating a sample checklist. Capture the task and real resulting file; do not claim autonomous success before it occurs." },
  { key: "code", match: /\b(code|engineering|secure|security|production|software factory|workflows?)\b/i, priority: "high", description: "Show a small build and its verification", action: "Open a public or demo repository, make a small visible change, then show its actual test or preview result. Hide credentials, environment files, private source and production data." },
  { key: "content", match: /\b(content|videos?|editing|captions?)\b/i, priority: "medium", description: "Show a real content edit progressing", action: "Record your own editor timeline or caption preview. Make one visible edit and preview the result; use media you own and hide private project names." },
  { key: "launch", match: /\b(ship(?:ped|ping)?|launch|products?|services?|income|get it out|getting it seen)\b/i, priority: "high", description: "Show a real product moving toward launch", action: "Record a real demo page or launch checklist, moving from a working feature to its preview. Do not fabricate customers, revenue, analytics or a published state." },
  { key: "templates", match: /\b(templates?|tools|live builds)\b/i, priority: "medium", description: "Show the actual reusable template or tool", action: "Open a real template or tool you can share and demonstrate one useful step with sample inputs. Keep unshipped or unavailable features clearly labeled." }
];

export function createBrollPlan(transcript, { durationSeconds, aspect = "16:9", maxCards = 12, shots = [] } = {}) {
  const lines = transcriptLines(transcript);
  const inferredDuration = Math.max(0, ...lines.map((line) => line.end));
  const duration = durationSeconds === undefined ? inferredDuration : Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("durationSeconds must be positive");
  if (!["16:9", "9:16", "1:1", "4:5"].includes(aspect)) throw new Error("Unsupported capture aspect");
  if (!Number.isInteger(maxCards) || maxCards < 1) throw new Error("maxCards must be a positive integer");
  if (!Array.isArray(shots)) throw new Error("shots must be an array");

  const candidates = [];
  const seen = new Set();
  for (const line of lines) {
    const rule = RULES.find((entry) => entry.match.test(line.text) && !seen.has(entry.key));
    if (!rule) continue;
    const span = boundedSpan(line.start, line.end, duration);
    if (!span) continue;
    seen.add(rule.key);
    candidates.push({ ...span, spoken_line: line.text, shot_description: rule.description, capture_instructions: instructions(rule.action, aspect), priority: rule.priority, key: rule.key });
  }

  for (const shot of shots) {
    const span = boundedSpan(shot.start_seconds, shot.end_seconds, duration);
    if (!span) throw new Error("Explicit shot needs a valid timeline span");
    const description = String(shot.shot_description ?? "").trim();
    if (!description) throw new Error("Explicit shot needs shot_description");
    const line = lines.filter((entry) => entry.start < span.end_seconds && entry.end > span.start_seconds).map((entry) => entry.text).join(" ");
    candidates.push({ ...span, spoken_line: String(shot.spoken_line ?? line).trim(), shot_description: description, capture_instructions: instructions(String(shot.capture_instructions ?? "Record the actual screen or object described, using your own or demo material."), aspect), priority: ["high", "medium", "low"].includes(shot.priority) ? shot.priority : "medium", key: "custom" });
  }
  candidates.sort((a, b) => a.start_seconds - b.start_seconds);
  const cards = candidates.slice(0, maxCards).map(({ key, ...card }, index) => {
    const id = `broll-${String(index + 1).padStart(2, "0")}`;
    return { id, ...card, status: "planned", media_path: null, suggested_filename: `${id}-${key}.mp4`, capture_duration_seconds: 12 };
  });
  return { schema_version: BROLL_PLAN_SCHEMA_VERSION, planning_method: "offline-keyword-heuristics", duration_seconds: duration, aspect, notes: "Suggestions use spoken-topic keywords, not AI interpretation or verified product proof. Review each card against the real product before capture. Times refer to the supplied transcript timeline; supply remapped words after editing.", cards };
}

export function renderBrollChecklist(plan) {
  const output = ["# B-roll capture checklist", "", plan.notes, "", `Capture aspect: ${plan.aspect}. Record 10–15 seconds per shot, including a still hold before and after the action.`, "", "Use demo data. Hide credentials, private messages and production data. Review every recording before sharing.", ""];
  for (const card of plan.cards) {
    output.push(`## ${card.id}: ${card.shot_description}`, "", `- [${card.status === "captured" ? "x" : " "}] ${card.priority} priority — ${card.status}`, `- Edit placement: ${card.start_seconds.toFixed(2)}–${card.end_seconds.toFixed(2)}s`, `- Spoken line: ${card.spoken_line.replace(/\s+/g, " ")}`, `- Capture: ${card.capture_instructions}`, `- Save as: ${card.suggested_filename}`, `- Media: ${card.media_path ?? "not captured"}`, "");
  }
  if (!plan.cards.length) output.push("No keyword-based shots suggested. Add explicit shots for this subject.", "");
  return output.join("\n");
}

function instructions(action, aspect) {
  return `${action} Record 10–15 seconds in ${aspect}, with a 2-second steady hold before and after the action. Keep the cursor deliberate and hide sensitive data.`;
}

function boundedSpan(start, end, duration) {
  const from = Number(start);
  const to = Number(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || from >= duration) return null;
  return { start_seconds: from, end_seconds: Math.min(to, duration) };
}

function transcriptLines(transcript) {
  let entries;
  let wordMode = true;
  if (Array.isArray(transcript)) entries = transcript;
  else if (Array.isArray(transcript?.words)) entries = transcript.words;
  else if (Array.isArray(transcript?.segments)) {
    const segments = transcript.segments;
    if (segments.every((segment) => Array.isArray(segment.words))) entries = segments.flatMap((segment) => segment.words);
    else { entries = segments; wordMode = false; }
  } else throw new Error("Transcript needs words or timed segments");
  const normalized = entries.map((entry) => ({ text: String(entry.text ?? entry.word ?? "").trim(), start: Number(entry.start), end: Number(entry.end) }));
  let lastStart = -1;
  for (const entry of normalized) {
    if (!entry.text || !Number.isFinite(entry.start) || !Number.isFinite(entry.end) || entry.start < 0 || entry.end <= entry.start || entry.start < lastStart) throw new Error("Transcript timings must be finite, ordered and positive");
    lastStart = entry.start;
  }
  if (!wordMode) return normalized;
  const lines = [];
  let current = null;
  for (const word of normalized) {
    if (current && (word.start - current.end > 1.2 || current.text.split(/\s+/).length >= 24)) { lines.push(current); current = null; }
    current = current ? { text: `${current.text} ${word.text}`, start: current.start, end: word.end } : { ...word };
    if (/[.!?]$/.test(word.text)) { lines.push(current); current = null; }
  }
  if (current) lines.push(current);
  return lines;
}
