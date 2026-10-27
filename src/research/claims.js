// Claim extraction: every checkable sentence of a script or topic outline,
// with the numbers, dates, quotes and named entities that make it checkable.
//
// The deterministic pass is the floor and runs on both paths (metered make
// and the subscription agent). A model pass (make's client) or an agent's
// claims.json can add claims the patterns miss, such as a plain statement
// with no number ("the weights are open"); those merge in by text.

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const DATE_PATTERNS = [
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "g"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\.?,?\\s+\\d{4}\\b`, "g"),
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{4}\\b`, "g"),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b(?:in|since|by|from|until|of)\s+((?:19|20)\d{2})\b/gi
];
// A number with what it counts: 671B parameters, 128K tokens, 87.5%, $0.28, 3x.
const NUMBER_PATTERN = /(?<![\w.])(\$|€|£)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(%|percent|x\b|×|[kKmMbBtT]\b|thousand|million|billion|trillion)?(?:\s?(parameters?|params|tokens?|context|experts?|layers|GPUs?|hours?|days?|weeks?|languages?|downloads|stars|likes|points?|elo|ms|seconds?|minutes?|tok\/s|tokens\/s|per\s+million|\/\s?M))?/g;
const QUOTE_PATTERN = /[“"]([^”"]{12,400})[”"]/g;
const SKIP_NUMBER_CONTEXT = /^(?:step|part|chapter|scene|beat|section)$/i;
const STOP_ENTITIES = new Set(["The", "This", "That", "These", "Those", "It", "Its", "And", "But", "So", "Then", "Now", "Here", "There", "What", "Why", "How", "When", "Where", "Who", "We", "You", "They", "I", "In", "On", "At", "For", "With", "From", "By", "Of", "A", "An", "If", "Or", "As", "Today", "Tomorrow", "Yesterday", "First", "Second", "Third", "Next", "Last", "Finally", "Also", "Just", "Not", "No", "Yes", "All", "Every", "Some", "Most", "One", "Two", "Three", "Ten", "Meanwhile", "However", "According", "Still", "Even", "Only", "Our", "My", "Your", "Their", "His", "Her", "Let", "Let's", "Is", "Are", "Was", "Were", "Be", "Do", "Does", "Did", "Can", "Could", "Would", "Should", "Will", "May", "Might", "Must", "Imagine", "Picture", "Think", "Look", "See", "Watch", "Remember", "Because", "While", "After", "Before", "Since", "Until", "Unlike", "Like"]);
const BENCHMARK_NAME = /bench|eval|mmlu|swe|exam|arena|gpqa|aime|hle\b|math|leaderboard|humaneval|livecode|mmmu|ifeval|bfcl|tau-?bench/i;
const ROLE_WORDS = new Set(["CEO", "CTO", "CFO", "COO", "Founder", "Co-founder", "President", "Chairman", "Professor", "Dr", "Mr", "Ms", "Mrs", "Director", "Chief", "Head", "Lead", "Senior", "Principal"]);
const PERSON_CUES = /\b(?:CEO|CTO|founder|co-founder|researcher|scientist|engineer|professor|director|lead|head of|chief|author|said|says|wrote|writes|posted|tweeted|told|according to|announced)\b/i;
const ORG_SUFFIX = /\b(?:AI|Labs?|Inc|Corp|Research|University|Institute|Foundation|Technologies|Systems|DeepMind|Group)\b/;

/** Markdown or plain text → sentences, keeping headings as context. */
export function splitSentences(text) {
  const sentences = [];
  let section = null;
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  let paragraph = [];
  const flush = () => {
    const joined = paragraph.join(" ").replace(/\s+/g, " ").trim();
    paragraph = [];
    if (!joined) return;
    // Split on sentence ends, not on decimals (87.5), versions (V4.1) or initials (U.S.).
    const parts = joined.split(/(?<=[.!?…][”"’)]?)\s+(?=[“"(]?[A-Z0-9$])/);
    for (const part of parts) {
      const sentence = part.trim();
      if (sentence.length >= 8) sentences.push({ text: sentence, section });
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) { flush(); section = heading[1].trim(); continue; }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(line)) { flush(); paragraph.push(line.replace(/^(?:[-*+]|\d+[.)])\s+/, "")); flush(); continue; }
    if (/^(?:```|<!--|---$|\|)/.test(line)) continue;
    paragraph.push(line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, ""));
  }
  flush();
  return sentences;
}

export function extractNumbers(sentence) {
  const values = [];
  // Identifiers and dates hold digits that are not quantities.
  let masked = sentence.replace(/https?:\/\/[^\s)"”]+|\barXiv:?\s?\d{4}\.\d{4,5}(?:v\d+)?|\b[\w.-]+\/[\w.-]+/gi, (span) => " ".repeat(span.length));
  for (const date of extractDates(sentence)) masked = masked.split(date).join(" ".repeat(date.length));
  for (const match of masked.matchAll(NUMBER_PATTERN)) {
    const [raw, currency, digits, scale, unit] = match;
    if (!digits) continue;
    const before = sentence.slice(Math.max(0, match.index - 12), match.index).trim().split(/\s+/).pop() ?? "";
    // Bare small integers with no unit are usually prose ("two reasons"), not claims; years are dates.
    if (!currency && !scale && !unit && /^(?:19|20)\d{2}$/.test(digits)) continue;
    if (!currency && !scale && !unit && Number(digits.replace(/,/g, "")) < 10) continue;
    if (SKIP_NUMBER_CONTEXT.test(before)) continue;
    // A version number (V4.1, GPT-5.5) is part of a name, not a quantity.
    const prior = sentence[match.index - 1];
    if (prior && /[A-Za-z-]/.test(prior)) continue;
    values.push({ raw: raw.trim(), value: numericValue(digits, scale), unit: normalizeUnit(currency, scale, unit) });
  }
  return values;
}

export function numericValue(digits, scale) {
  const base = Number(String(digits).replace(/,/g, ""));
  const multiplier = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 }[String(scale ?? "").toLowerCase()] ?? 1;
  return Number((base * multiplier).toPrecision(12));
}

function normalizeUnit(currency, scale, unit) {
  if (currency) return { "$": "usd", "€": "eur", "£": "gbp" }[currency];
  if (scale && /^(?:%|percent)$/i.test(scale)) return "percent";
  if (scale && /^(?:x|×)$/i.test(scale)) return "multiple";
  if (unit) return unit.toLowerCase().replace(/s$/, "").replace(/\s+/g, " ");
  return null;
}

export function extractDates(sentence) {
  const found = new Set();
  for (const pattern of DATE_PATTERNS) {
    for (const match of sentence.matchAll(pattern)) found.add((match[1] ?? match[0]).trim());
  }
  // A full date wins over the bare year inside it.
  return [...found].filter((date) => ![...found].some((other) => other !== date && other.includes(date)));
}

export function extractQuotes(sentence) {
  return [...sentence.matchAll(QUOTE_PATTERN)].map((match) => match[1].trim());
}

/** Named entities: repos, Hugging Face ids, arXiv ids, URLs, model names, people, organisations. */
export function extractEntities(sentence) {
  const entities = [];
  const add = (name, kind) => {
    const clean = name.replace(/[.,;:!?)]+$/, "").trim();
    if (clean && !entities.some((entity) => entity.name === clean)) entities.push({ name: clean, kind });
  };
  for (const match of sentence.matchAll(/https?:\/\/[^\s)"”]+/g)) add(match[0], "url");
  for (const match of sentence.matchAll(/\barXiv:?\s?(\d{4}\.\d{4,5})(?:v\d+)?\b/gi)) add(`arXiv:${match[1]}`, "paper");
  const withoutUrls = sentence.replace(/https?:\/\/[^\s)"”]+/g, " ");
  for (const match of withoutUrls.matchAll(/\b([A-Za-z0-9][\w.-]{1,38})\/([A-Za-z0-9][\w.-]{1,99})\b/g)) {
    if (/^\d+$/.test(match[1]) || /^\d+$/.test(match[2])) continue;
    add(`${match[1]}/${match[2]}`, "repo");
  }
  // Model-like names: a capitalised word joined to a version (DeepSeek-V4.1, GPT-5.5, Llama 4, Qwen3.8-27B).
  for (const match of withoutUrls.matchAll(/\b([A-Z][A-Za-z]+(?:[- ][A-Z][A-Za-z]+)?(?:[- ]?[vV]?\d+(?:\.\d+)*[A-Za-z]*)(?:[- ][A-Za-z0-9.]+)*?)(?=[\s,.;:!?)"”']|$)/g)) {
    const words = match[1].split(" ");
    while (words.length > 1 && STOP_ENTITIES.has(words[0])) words.shift();
    // "HumanEval Nimbus-7B": a benchmark word run into the model after it.
    if (words.length > 1 && BENCHMARK_NAME.test(words[0]) && !/\d/.test(words[0]) && /^[A-Z][a-z]/.test(words[1])) add(words.shift(), "benchmark");
    const name = words.join(" ");
    if (!/\d/.test(name) || /^(?:19|20)\d{2}$/.test(name) || new RegExp(`^(?:${MONTHS})\\b`).test(name)) continue;
    // "On Terminal-Bench 4.0", "MMLU-Pro", "DeepSWE v1.1": a benchmark is what a model is measured on, not a model.
    const measuredOn = /\b(?:on|in)\s*$/i.test(withoutUrls.slice(0, match.index + match[1].indexOf(name)));
    add(name, BENCHMARK_NAME.test(name) || measuredOn ? "benchmark" : "model");
  }
  // Capitalised runs: people and organisations.
  for (const match of withoutUrls.matchAll(/\b([A-Z][a-zA-Z&'’-]+(?:\s+(?:[A-Z][a-zA-Z&'’-]+|of|de|van|von|der|la)){0,4})/g)) {
    const words = match[1].split(/\s+/).filter((word, index, all) => !(index === all.length - 1 && /^(?:of|de|van|von|der|la)$/.test(word)));
    while (words.length && (STOP_ENTITIES.has(words[0]) || ROLE_WORDS.has(words[0]) || /^[a-z]/.test(words[0]))) words.shift();
    if (!words.length) continue;
    const name = words.join(" ").replace(/['’]s$/, "");
    // Inside a longer entity (DeepSeek in DeepSeek-V4.1) only counts when it also stands alone.
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (entities.some((entity) => entity.name === name) || (entities.some((entity) => entity.name.includes(name)) && !new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(withoutUrls))) continue;
    if (new RegExp(`^(?:${MONTHS})$`).test(name)) continue;
    // Start of sentence with a single ordinary word is not an entity.
    if (words.length === 1 && match.index === 0 && !ORG_SUFFIX.test(name) && !/[A-Z].*[A-Z]/.test(name)) continue;
    if (words.length === 1 && name.length < 3) continue;
    const kind = BENCHMARK_NAME.test(name) ? "benchmark"
      : ORG_SUFFIX.test(name) || /[A-Z].*[A-Z]/.test(words[0]) && words.length === 1 ? "org"
      : words.length >= 2 && words.length <= 3 && words.every((word) => /^[A-Z][a-z'’-]+$/.test(word)) && PERSON_CUES.test(sentence) ? "person"
      : "name";
    add(name, kind);
  }
  return entities;
}

/**
 * text → [{id, text, kind, section, values, dates, quote, entities}]: one
 * claim per checkable sentence, kind the most specific anchor it carries
 * (quote > number > date > entity). Opinion with nothing to check is left out.
 */
export function extractClaims(text) {
  const claims = [];
  for (const { text: sentence, section } of splitSentences(text)) {
    const values = extractNumbers(sentence);
    const dates = extractDates(sentence);
    const quotes = extractQuotes(sentence);
    const entities = extractEntities(sentence);
    const named = entities.filter((entity) => entity.kind !== "name" || entity.name.split(" ").length > 1 || /[A-Z].*[A-Z]|\d/.test(entity.name));
    if (!values.length && !dates.length && !quotes.length && !named.length) continue;
    // A question or call to action states nothing.
    if (/\?$/.test(sentence) || /^(?:subscribe|like|comment|follow|hit|smash)\b/i.test(sentence)) continue;
    const kind = quotes.length ? "quote" : values.length ? "number" : dates.length ? "date" : "entity";
    claims.push({ id: `c${String(claims.length + 1).padStart(3, "0")}`, text: sentence, kind, section, values, dates, quote: quotes[0] ?? null, entities, origin: "pattern" });
  }
  return claims;
}

/** Folds claims from a model or an agent's claims.json in, by text; new ones get the next ids. */
export function mergeClaims(base, extra = []) {
  const merged = base.map((claim) => ({ ...claim }));
  const key = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const claim of extra) {
    if (!claim?.text) continue;
    const existing = merged.find((entry) => key(entry.text) === key(claim.text));
    if (existing) {
      for (const field of ["search", "subject", "expect"]) if (claim[field] && !existing[field]) existing[field] = claim[field];
      continue;
    }
    const parsed = extractClaims(claim.text)[0];
    merged.push({
      id: `c${String(merged.length + 1).padStart(3, "0")}`,
      text: claim.text,
      kind: claim.kind ?? parsed?.kind ?? "statement",
      section: claim.section ?? null,
      values: parsed?.values ?? [],
      dates: parsed?.dates ?? [],
      quote: parsed?.quote ?? null,
      entities: parsed?.entities ?? [],
      ...(claim.search ? { search: claim.search } : {}),
      ...(claim.subject ? { subject: claim.subject } : {}),
      origin: claim.origin ?? "model"
    });
  }
  return merged;
}

/** Every entity across the claims, de-duplicated, with the claims that mention it. */
export function entityIndex(claims) {
  const index = new Map();
  for (const claim of claims) {
    for (const entity of claim.entities ?? []) {
      const entry = index.get(entity.name) ?? { name: entity.name, kind: entity.kind, claims: [] };
      if (entry.kind === "name" && entity.kind !== "name") entry.kind = entity.kind;
      entry.claims.push(claim.id);
      index.set(entity.name, entry);
    }
  }
  return [...index.values()];
}

/** The metered pass: make's runStructured client lists claims the patterns miss. */
export async function modelClaims({ client, text }) {
  const result = await client.runStructured({
    instructions: "List every checkable factual claim in the text: numbers, dates, quotes, named releases, people and their roles, and plain factual statements. Copy each claim's sentence verbatim from the text. Add a short web search query that would find its primary source. Skip opinions, jokes and calls to action.",
    input: String(text),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["claims"],
      properties: {
        claims: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["text", "search"], properties: { text: { type: "string" }, search: { type: "string" } } }
        }
      }
    },
    schemaName: "launchclip_research_claims",
    maxOutputTokens: 4000
  });
  const value = result?.value ?? (() => { try { return JSON.parse(result?.text ?? "{}"); } catch { return {}; } })();
  return { claims: (value.claims ?? []).map((claim) => ({ ...claim, origin: "model" })), usage: result?.usage ?? null };
}
