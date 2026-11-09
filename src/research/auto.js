// --research auto (the default in `launchclip make`): whether a brief is
// news or research shaped, from its words alone. No model and no network.
//
// Research turns on for a brief about something that happened: news wording
// ("news", "this week", "just announced"), a dated event, a named release
// with a release verb, or a question of fact about something named. It stays
// off for a brief that brings its own material (a recording, a voiceover, a
// written script) and for a product video (launch, promo, demo, tutorial),
// where the facts are the brand's own to state. Every decision carries its
// reason and the words that led to it, for the run report.
import { extractDates, extractEntities, splitSentences } from "./claims.js";

// Plainly news, whatever else the brief says.
const NEWS_WORDING = /\b(?:news|breaking|headlines?|round-?up|this week(?:'s|’s)?|this month(?:'s|’s)?|this morning|yesterday|last (?:week|night|month)|today(?:'s|’s)|just (?:announced|released|launched|dropped|shipped|unveiled)|what (?:just )?happened|fact[- ]check)\b/i;
// News only when nothing says the video is the brand's own.
const RECENT_WORDING = /\b(?:latest|recent(?:ly)?|newest|what(?:'s|’s| is) new|update on)\b/i;
const RELEASE_VERB = /\b(?:announc(?:e[sd]?|ing|ement)|releas(?:e[sd]?|ing)|launch(?:e[sd]|ing)|unveil(?:s|ed|ing)?|introduc(?:e[sd]|ing)|ship(?:s|ped)|acquir(?:e[sd]|ing)|beats|outperform(?:s|ed)?|vs\.?|versus|compared (?:to|with)|benchmarks?)\b/i;
// The video is the brand's own: a brief for one of these states the brand's facts, not the world's.
const PRODUCT_VIDEO = /\b(?:launch video|product video|promo(?:tional)?|advert(?:isement)?|ad for|commercial|demo|trailer|teaser|tutorial|how[- ]to|walk-?through|onboarding|testimonial|case study|(?:tool |product |feature )?explainer for|(?:our|my) (?:own |new )?(?:product|app|tool|company|startup|service|platform|feature|release|launch|pricing|cli|api|sdk|plugin))\b/i;
// The brief brings its own words: a section holding the script or narration.
const OWN_SCRIPT = /^#{1,6}\s+(?:script|narration|voice-?over|final copy)\b/im;
const FACT_QUESTION = /^(?:what|who|when|where|which|why|how (?:many|much)|did|does|do|is|are|was|were|has|have|will|can)\b.*\?$/i;

/**
 * The brief's news and research signals. → [{kind, strength: "strong"|"weak", match}]
 * kinds: news-wording, recent-wording, dated-event, named-release, fact-question.
 */
export function briefSignals(text) {
  const brief = String(text ?? "");
  const signals = [];
  const add = (kind, strength, match) => { if (!signals.some((entry) => entry.kind === kind)) signals.push({ kind, strength, match: String(match).trim().slice(0, 80) }); };
  const news = brief.match(NEWS_WORDING);
  if (news) add("news-wording", "strong", news[0]);
  const recent = brief.match(RECENT_WORDING);
  if (recent) add("recent-wording", "weak", recent[0]);
  for (const { text: sentence } of splitSentences(brief.endsWith(".") || brief.endsWith("?") ? brief : `${brief}.`)) {
    // A day or a month is an event; a bare year ("since 2019") is background.
    const dates = extractDates(sentence).filter((date) => !/^(?:19|20)\d{2}$/.test(date));
    if (dates.length) add("dated-event", "strong", dates[0]);
    const entities = extractEntities(sentence);
    const release = entities.find((entity) => entity.kind === "model");
    const named = release ?? entities.find((entity) => entity.kind === "org" || entity.kind === "person");
    if (named && RELEASE_VERB.test(sentence)) add("named-release", "strong", `${named.name} (${sentence.match(RELEASE_VERB)[0]})`);
    // On its own, only a name versioned like a release counts ("GPT-5.5", "Nimbus-7B"), not "Reconcile 10,000".
    else if (release && /[-.]\d|\d\.\d|[A-Za-z]\d/.test(release.name)) add("named-release", "weak", release.name);
    if (FACT_QUESTION.test(sentence.trim()) && (named || entities.some((entity) => entity.kind === "name" && /[A-Z].*[A-Z]|\d|\s/.test(entity.name)))) add("fact-question", "weak", sentence);
  }
  return signals;
}

const SIGNAL_WORDS = { "news-wording": "news wording", "recent-wording": "recency wording", "dated-event": "a dated event", "named-release": "a named release", "fact-question": "a question of fact" };

/**
 * Whether --research auto researches this brief.
 * input: {text (prompt plus notes), lane ("motion" | "voiceover-motion" | "footage-led"), media (count of supplied media files)}
 * → {run, reason, signals: ["news wording: \"this week\"", …]}
 */
export function autoResearch({ text, lane = "motion", media = 0 } = {}) {
  const signals = briefSignals(text);
  const listed = signals.map((entry) => `${SIGNAL_WORDS[entry.kind]}: "${entry.match}"`);
  const off = (reason) => ({ run: false, reason, signals: listed });
  if (lane !== "motion") return off(`the ${lane} lane takes its words from the supplied recording, and research checks a script before it is written`);
  if (OWN_SCRIPT.test(String(text ?? ""))) return off("the brief supplies its own script, so there is nothing for research to write from (pass --research on to check it anyway)");
  const strong = signals.filter((entry) => entry.strength === "strong");
  const product = String(text ?? "").match(PRODUCT_VIDEO);
  if (signals.some((entry) => entry.kind === "news-wording")) return { run: true, reason: `the brief reads as news (${listed[signals.findIndex((entry) => entry.kind === "news-wording")]})`, signals: listed };
  if (product) return off(`the brief asks for a ${product[0].toLowerCase().replace(/ for$/, "")}${media ? ` with ${media} supplied media file${media === 1 ? "" : "s"}` : ""}: the facts are the brand's own (pass --research on to check them)`);
  if (strong.length) return { run: true, reason: `the brief is about something that happened (${listed[signals.indexOf(strong[0])]})`, signals: listed };
  if (signals.length) return { run: true, reason: `the brief asks about something checkable (${listed[0]})`, signals: listed };
  return off("the brief names no dated event, news or recency wording, named release or question of fact");
}
