// Plain words for the finish gates (docs/guide/headless.md, "What a held
// render says"): every finding that has a time gets `at` (seconds), and every
// failed gate gets `at` (the times of the findings that hold it) and a
// `summary`, one line for the person who made the video: no gate names, no
// ratios. Apps show the summary instead of paraphrasing the findings.

// Severities that hold a render; the rest are warnings and advice.
const HOLDING = new Set(["error", "blocking", "major"]);

const EMPTY = "The screen looks empty in places";
const STILL = "The picture stands still in places";
const SLOW_OPEN = "The opening is slow to get going";
const MOUTHS = "Mouths don't match the voice";

// By finding rule (or motion category), most specific first.
const RULES = {
  "caption-illegible": "Some captions are hard to read over what's behind them",
  contrast: "Some text is hard to read against its background",
  "text-hold": "Some text isn't on screen long enough to read",
  "slow-text-fade": "Some text fades in or out too slowly",
  "two-copies": "A character shows up twice at once",
  "ghost-character": "A character looks see-through",
  "sparse-run": EMPTY,
  "sparse-share": EMPTY,
  "sparse-ending": "The ending looks empty",
  "empty-region": EMPTY,
  "empty-plate": EMPTY,
  "slow-hook": SLOW_OPEN,
  "flat-hook": SLOW_OPEN,
  hook: SLOW_OPEN,
  "event-gap": "Nothing new happens for a while in places",
  "frozen-frame": STILL,
  "static-hold": STILL,
  "still-shot": STILL,
  stillness: STILL,
  "mouth-open-silent": MOUTHS,
  "mouth-closed": MOUTHS,
  "action-missing": "Characters don't act out what's said",
  duration: "The video is the wrong length",
  dimensions: "The video is the wrong size"
};

// By gate, when no finding names a rule above.
const GATES = {
  placeholders: "A scene couldn't be drawn and shows a placeholder card",
  layout: "Some text or graphics overlap or run off the edge",
  physics: "Something moves in a way that looks wrong",
  ghosting: "Some text or characters fade in and out awkwardly",
  density: "Some scenes are too crowded or too bare",
  visual_density: EMPTY,
  variety: "Too many scenes look alike",
  tells: "Some parts look template-made",
  holds: "Some shots hold too long",
  states: "Some on-screen changes don't land",
  choreography: "Some movement looks clumsy",
  captions: "Captions are hidden behind graphics in places",
  loudness: "The sound is too quiet or too loud",
  motion: "Parts of the video barely move",
  audio: "Something is off with the sound",
  temporal_evidence: "The render's check files are incomplete",
  style: "The video drifts from its chosen style",
  direction: "The video's plan is incomplete",
  acting: "Characters don't act out what's said",
  "lip-sync": MOUTHS,
  coverage: "Some lines have nothing matching on screen",
  face: "Faces are covered or cut off",
  constraints: "The video breaks one of the rules set for it",
  structure: "The video doesn't follow the short-video structure",
  hook: SLOW_OPEN,
  pace: "The pacing drags in places",
  subject: "The cut-out of the person doesn't hold up",
  cast: "The characters don't match their descriptions",
  bible: "The characters change look between scenes"
};

const seconds = (finding) => [finding?.at, finding?.start_seconds, finding?.time].map((value) => (value === null || value === "" ? NaN : Number(value))).find(Number.isFinite);

/** 16.2 → "0:16" */
export function clockTime(value) {
  const whole = Math.floor(Number(value) + 1e-6);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** One gate, with `at` on its timed findings and, when it failed, a gate `at` and `summary`. */
export function explainGate(name, gate) {
  if (!gate || typeof gate !== "object") return gate;
  const findings = Array.isArray(gate.findings) ? gate.findings.map((finding) => {
    const at = finding && typeof finding === "object" ? seconds(finding) : undefined;
    return at === undefined || finding.at === at ? finding : { ...finding, at };
  }) : gate.findings;
  const out = findings === gate.findings ? { ...gate } : { ...gate, findings };
  if (gate.status !== "failed") return out;
  const objects = (findings ?? []).filter((finding) => finding && typeof finding === "object");
  const holding = objects.filter((finding) => HOLDING.has(finding.severity));
  const lead = (holding.length ? holding : objects).find((finding) => RULES[finding.rule ?? finding.category]);
  const phrase = lead ? RULES[lead.rule ?? lead.category] : GATES[name] ?? "Something needs a look before you post";
  // The times of the findings that say the same thing, to the second.
  const same = (lead ? holding.filter((finding) => RULES[finding.rule ?? finding.category] === phrase) : holding);
  const times = [...new Set(same.map(seconds).filter((value) => value !== undefined).map((value) => Math.floor(value + 1e-6)))].sort((a, b) => a - b);
  out.at = times;
  out.summary = times.length && phrase !== SLOW_OPEN ? `${phrase} (${times.slice(0, 3).map(clockTime).join(", ")}${times.length > 3 ? ", …" : ""})` : phrase;
  return out;
}

/** Every gate in a gates object (runGates' result), explained. */
export function explainGates(gates) {
  return Object.fromEntries(Object.entries(gates ?? {}).map(([name, gate]) => [name, explainGate(name, gate)]));
}
