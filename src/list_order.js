// List order: a numbered list ("one, treated pine… two, hardwood…") is seen
// and heard in order. A later item may show up early only as a teaser that
// says so ("coming up", "stay for number three", "at the end"); said or shown
// bare ("And number three… bare feet", a "Material three" card) right after
// the hook, it reads as the list starting out of order.
//
//   listOrdinal(text)  the list position a line or label names, or null
//   isTeaser(text)     whether it marks itself as a promise of later
//   orderFindings(items) → [{index, ordinal, before}] items (in time order,
//     {text}) that name position n before any of 1..n-1 came, unmarked
//   storyboardOrderErrors(storyboard) → "order: …" planner repair notes

const WORDS = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7 };
const NUMBER = "(one|two|three|four|five|six|seven|[1-7])";
// "number three", "option 2", "material three", "step 4", "#3", "No. 3"
const NAMED = new RegExp(`(?:\\b(?:number|no\\.?|option|material|step|tip|item|pick|choice|mistake|reason|rule|way)\\s+${NUMBER}\\b|#\\s?([1-7])\\b)`, "i");
// "First · Treated pine", "Third: composite", a line that opens "Two, hardwood"
const LEAD = /^\s*(?:and\s+)?(first|second|third|fourth|fifth|one|two|three|four|five)\b\s*[,:·.—-]/i;
const TEASER = /\b(?:coming up|up next|later|at the end|by the end|till the end|until the end|stay for|stick around|wait for|keep watching|saved? (?:the best|it) for last|teaser|i'?ll (?:get to|show you|give you))\b/i;

const value = (raw) => { const key = String(raw).toLowerCase(); return WORDS[key] ?? (/^\d$/.test(key) ? Number(key) : null); };

/** The list position a line or label names ("number three", "Option 2 ·", "First · …"), or null. */
export function listOrdinal(text) {
  const line = String(text ?? "");
  const named = NAMED.exec(line);
  if (named) return value(named[1] ?? named[2]);
  const lead = LEAD.exec(line);
  return lead ? value(lead[1]) : null;
}

/** Whether a line or label marks itself as a promise of something later. */
export const isTeaser = (text) => TEASER.test(String(text ?? ""));

/** Items (in time order, {text}) that name list position n before 1..n-1 came, without saying they are a teaser. */
export function orderFindings(items) {
  const seen = new Set();
  const out = [];
  items.forEach((item, index) => {
    const ordinal = listOrdinal(item?.text);
    if (ordinal == null) return;
    const missing = Array.from({ length: ordinal - 1 }, (_, i) => i + 1).filter((n) => !seen.has(n));
    if (!missing.length) seen.add(ordinal);
    else if (!isTeaser(item.text)) out.push({ index, ordinal, before: missing[0] });
  });
  return out;
}

const NAME = ["zero", "one", "two", "three", "four", "five", "six", "seven"];
const TEXT_KEYS = ["kicker", "eyebrow", "label", "title", "headline", "heading", "text", "subtitle", "caption"];

// A scene's on-screen words, label first (a kicker names the item).
function sceneText(scene) {
  const params = scene?.params ?? {};
  return TEXT_KEYS.map((key) => params[key]).filter((entry) => typeof entry === "string" && entry.trim()).join(" · ");
}

/** The planner's notes for cards that show a later list item before the earlier ones, unlabelled. Scenes are taken in story order (track 0 first, as planned). */
export function storyboardOrderErrors(storyboard) {
  const scenes = (storyboard?.scenes ?? []).filter((scene) => (scene?.track ?? 0) === 0);
  return orderFindings(scenes.map((scene) => ({ text: sceneText(scene) })))
    .map(({ index, ordinal, before }) => `order: scene ${scenes[index].id} shows list item ${NAME[ordinal] ?? ordinal} before item ${NAME[before] ?? before}; if it is the open loop, label it as a teaser ("Coming up: …") and keep the item's own card for its turn, else move it into order`);
}
