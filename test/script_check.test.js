// Script checks (src/script_check.js): one test per rule, each with a passing
// and a failing script, and the fact-trace false-positive guards.
import assert from "node:assert/strict";
import test from "node:test";
import { checkScript, defaultFormat, formatCheckErrors, formatScriptCheck, numberClaims, splitSentences, syllableCount } from "../src/script_check.js";

const BRIEF = {
  prompt: "A 30-second launch video for Ledgerly, which reconciles Stripe payouts against invoices automatically.",
  notes: ["Ledgerly cut month-end close time by 40% for our beta teams. 3x faster than spreadsheets. Used by 1,200 finance teams. Pro plan is $49 a month."],
  assets: ["assets/ui.mp4 — video, screen-recording, 1280×720, 4s: the reconciliation screen"],
  transcripts: []
};
// 74 words, 30 s: 148 wpm, five short sentences, one CTA at the end.
const GOOD = "Month-end close should not take a week. Ledgerly matches every Stripe payout to its invoice the moment it lands. Your books stay clean without a single spreadsheet. Beta teams closed the month forty per cent faster, because nothing waits for a human to tick it off. When the auditor asks where a payout went, the answer is right there, with the invoice beside it. Your team gets its evenings back. Try Ledgerly free today.";

const check = (narration, extra = {}) => checkScript({ narration, duration: 30, brief: BRIEF, ...extra });
const ids = (report, kind = "errors") => report[kind].map((item) => item.id);

test("a clean script passes with stats", () => {
  const report = check(GOOD);
  assert.deepEqual(report.errors, [], formatScriptCheck(report));
  assert.equal(report.ok, true);
  assert.equal(report.stats.words, 74);
  assert.equal(report.stats.wpm, 148);
  assert.equal(report.stats.format, "short-form");
  assert.equal(report.stats.format_source, "duration");
  assert.equal(report.stats.ctas.length, 1);
  assert.equal(report.stats.audience, "b2b", "invoices and payouts in the brief read as B2B");
  assert.equal(report.stats.hook_words, 7);
});

test("fits-clock: more words than duration × 2.75 is an error; a slow read is a wpm-band warning", () => {
  const long = `${GOOD} ${"Every payout matches its invoice. ".repeat(3)}`.trim();
  const standard = { pace: "standard" };
  assert.ok(ids(check(long, standard)).includes("fits-clock"));
  const fix = check(long, standard).errors.find((item) => item.id === "fits-clock");
  assert.match(fix.message, /ceiling is 82/);
  assert.match(fix.fix, /Cut to about/);
  assert.ok(!ids(check(GOOD, standard)).includes("fits-clock"));
  // Short-form's default pace is fast: 4.2 words a second fit, and a 148 wpm read is slow for it.
  assert.ok(!ids(check(long)).includes("fits-clock"));
  assert.equal(check(GOOD).stats.pace, "fast");
  assert.ok(ids(check(GOOD), "warnings").includes("wpm-band"));
  assert.ok(ids(check(`${GOOD} ${"Every payout matches its invoice. ".repeat(12)}`.trim())).includes("fits-clock"));
  const slow = check(GOOD, { duration: 45, ...standard });
  assert.ok(ids(slow, "warnings").includes("wpm-band"));
  assert.equal(slow.ok, true);
  assert.ok(ids(check(GOOD, { duration: null }), "warnings").includes("no-duration"));
});

test("fact-trace: unsupported figures are errors; supported ones in any spelling pass", () => {
  const invented = check(GOOD.replace("forty per cent", "sixty per cent"));
  assert.deepEqual(ids(invented), ["fact-trace"]);
  assert.match(invented.errors[0].message, /"sixty per cent" is not in the brief/);
  assert.equal(invented.errors[0].span.text, "sixty per cent");
  assert.equal(invented.errors[0].span.sentence, 3);
  // Normalised matches: per cent ↔ %, three times ↔ 3x, money, thousands.
  for (const phrase of ["40%", "40 percent", "three times faster", "3x faster", "twelve hundred teams", "1,200 teams", "$49 a month", "forty-nine dollars a month"]) {
    const report = check(GOOD.replace("forty per cent faster", phrase));
    assert.ok(!ids(report).includes("fact-trace"), `${phrase}: ${formatCheckErrors(report.errors)}`);
  }
  for (const phrase of ["50%", "four times faster", "$59 a month", "10,000 teams", "2x faster"]) {
    assert.ok(ids(check(GOOD.replace("forty per cent faster", phrase))).includes("fact-trace"), phrase);
  }
});

test("fact-trace: rounding and hedges follow the brief value", () => {
  const brief = { prompt: "Ledgerly", notes: ["43.7% of payouts arrive split. 12,437 teams signed up."] };
  const ok = (text) => !ids(checkScript({ narration: `${text} Try Ledgerly free today.`, duration: 10, brief })).includes("fact-trace");
  assert.ok(ok("Forty-four per cent of payouts arrive split."), "rounded to the spoken precision");
  assert.ok(ok("About 4 in 10 payouts arrive split."), "a ratio within five points of a brief percentage");
  assert.ok(ok("Over 12,000 teams signed up."), "over: the brief value is at least as large");
  assert.ok(ok("About 12,000 teams signed up."));
  assert.ok(ok("Twelve thousand teams signed up."), "two significant figures round from 12,437");
  assert.ok(!ok("Over 20,000 teams signed up."));
  assert.ok(!ok("Ten thousand teams signed up."), "one significant figure needs a hedge");
  assert.ok(!ok("Half of 9 in 10 payouts arrive split."));
});

test("fact-trace false-positive guards: small counts, ordinals, product names and years", () => {
  const brief = { prompt: "Ledgerly reconciles payouts. Launched in 2024." };
  const clean = (text) => ids(checkScript({ narration: `${text} Try Ledgerly free today.`, duration: 20, brief })).filter((id) => id === "fact-trace");
  assert.deepEqual(clean("It takes two steps."), [], "a small bare count is phrasing");
  assert.deepEqual(clean("There are 3 ways to fix it."), []);
  assert.deepEqual(clean("Everything lives in one place."), []);
  assert.deepEqual(clean("The first step is the hardest."), [], "ordinals are not numbers");
  assert.deepEqual(clean("Steps one and two run on their own."), [], "\"one and two\" is two counts, not three");
  assert.deepEqual(clean("It launched in 2024."), []);
  // A small count with a unit or a measure noun is a claim.
  assert.deepEqual(clean("Set up in 3 clicks."), ["fact-trace"]);
  assert.deepEqual(clean("Setup takes five minutes."), ["fact-trace"]);
  assert.deepEqual(clean("It is twice as fast."), ["fact-trace"]);
  assert.deepEqual(clean("Save 5% on fees."), ["fact-trace"]);
  assert.deepEqual(clean("A hundred teams use it."), ["fact-trace"]);
});

test("numberClaims parses digits, words, units and ratios", () => {
  const claims = numberClaims("We saved $4,500 and 40 per cent, ran 3x faster, hit ten thousand users, a million rows and 4 in 10 checks.");
  assert.deepEqual(claims.filter((claim) => !claim.part).map((claim) => [claim.value, claim.unit]), [[4500, "$"], [40, "%"], [3, "x"], [10000, ""], [1e6, ""], [4, ""]]);
  assert.equal(claims.find((claim) => claim.ratio).ratio.percent, 40);
  assert.equal(numberClaims("two hundred and fifty")[0].value, 250);
  assert.equal(numberClaims("10k teams")[0].value, 10000);
  assert.equal(numberClaims("1.5 million")[0].value, 1.5e6);
});

test("testimonial: a quote or customer attribution must be in the brief", () => {
  const quoted = check(GOOD.replace("Your team gets its evenings back.", "One user wrote, \"I got my evenings back.\""));
  assert.ok(ids(quoted).includes("testimonial"));
  const sourced = checkScript({ narration: GOOD.replace("Your team gets its evenings back.", "One user wrote, \"I got my evenings back.\""), duration: 30, brief: { ...BRIEF, notes: [...BRIEF.notes, "Maya (beta): \"I got my evenings back.\""] } });
  assert.ok(!ids(sourced).includes("testimonial"));
  const attributed = check(GOOD.replace("Your team gets its evenings back.", "Customers say it changed their whole quarter."));
  assert.ok(ids(attributed).includes("testimonial"));
  assert.ok(ids(check(GOOD.replace("Your team gets its evenings back.", "Jane Doe from Acme Corp loves it."))).includes("placeholder"));
});

test("social-proof: trusted-by, ratings, #1 and award claims need the brief", () => {
  for (const line of ["Trusted by finance teams everywhere.", "Rated five stars by accountants.", "It is the number one reconciliation app.", "An award-winning close tool.", "Thousands of teams switched last year."]) {
    assert.ok(ids(check(GOOD.replace("Your team gets its evenings back.", line))).includes("social-proof"), line);
  }
  // Supported: the brief says "Used by 1,200 finance teams", enough for "hundreds" but not "thousands".
  assert.ok(!ids(check(GOOD.replace("Your team gets its evenings back.", "Used by 1,200 finance teams."))).includes("social-proof"));
  assert.ok(!ids(check(GOOD.replace("Your team gets its evenings back.", "Hundreds of teams switched last year."))).includes("social-proof"));
});

test("urgency: scarcity and deadlines need a real one in the brief", () => {
  for (const line of ["Only 3 spots left.", "The offer ends Friday.", "Today only."]) {
    assert.ok(ids(check(GOOD.replace("Your team gets its evenings back.", line))).includes("urgency"), line);
  }
  assert.ok(!ids(check(GOOD)).includes("urgency"), "\"free today\" is not urgency");
  const withDeadline = checkScript({ narration: GOOD.replace("Your team gets its evenings back.", "The launch offer ends Friday."), duration: 30, brief: { ...BRIEF, notes: [...BRIEF.notes, "Launch offer: 20% off until Friday 14 November."] } });
  assert.ok(!ids(withDeadline).includes("urgency"));
});

test("no brief: the trace is skipped with a warning, the rest still runs", () => {
  const report = checkScript({ narration: GOOD.replace("forty per cent", "ninety per cent"), duration: 30 });
  assert.ok(!ids(report).includes("fact-trace"));
  assert.ok(ids(report, "warnings").includes("no-brief"));
  assert.equal(report.ok, true);
});

test("opener: greetings and filler are errors; so is a hook over budget", () => {
  assert.ok(!ids(check(GOOD.replace("Month-end close should not take a week.", "Your close should not take a week."))).includes("opener-filler"), "\"Your\" is not \"yo\"");
  for (const opener of ["Hey guys, month-end close should not take a week.", "Welcome back to the channel.", "In this video we fix month-end close.", "Today we're going to fix month-end close.", "So, month-end close is slow."]) {
    assert.ok(ids(check(GOOD.replace("Month-end close should not take a week.", opener))).includes("opener-filler"), opener);
  }
  assert.ok(!ids(check(GOOD)).includes("opener-filler"));
  const long = check(GOOD.replace("Month-end close should not take a week.", "Month-end close should not take a whole week of your finance team chasing every payout."));
  assert.ok(ids(long).includes("opener-length"));
  assert.ok(!ids(check(GOOD.replace("Month-end close should not take a week.", "Month-end close should not take a whole week of your finance team chasing every payout."), { format: "long-form", duration: 30 })).includes("opener-length"), "long-form hooks get 15 words");
  assert.ok(!ids(checkScript({ narration: GOOD, duration: 30, brief: BRIEF, limits: { hookWords: 7 } })).includes("opener-length"));
  assert.ok(ids(checkScript({ narration: GOOD, duration: 30, brief: BRIEF, limits: { hookWords: 6 } })).includes("opener-length"), "the hook budget is configurable");
});

test("cta: exactly one, at the end; tutorial imperatives are not CTAs", () => {
  assert.ok(ids(check(GOOD.replace(" Try Ledgerly free today.", ""))).includes("cta-missing"));
  const two = check(GOOD.replace("Try Ledgerly free today.", "Try Ledgerly free today, and follow us for more."));
  assert.ok(ids(two).includes("cta-multiple"));
  assert.ok(ids(check(GOOD.replace("Try Ledgerly free today.", "Download Ledgerly free today. Subscribe for more."))).includes("cta-multiple"));
  const early = check(GOOD.replace("Your books stay clean without a single spreadsheet.", "Sign up at ledgerly.com."));
  assert.ok(ids(early).includes("cta-early"));
  assert.ok(!ids(checkScript({ narration: "Payouts never match. Ledgerly fixes it. Try Ledgerly free.", duration: 6, brief: BRIEF })).includes("cta-early"), "the last sentence is the end, however short the script");
  // Instructions inside an explainer are not calls to action.
  const tutorial = check(GOOD.replace("Your books stay clean without a single spreadsheet.", "Then click Export and open the report."));
  assert.ok(!ids(tutorial).some((id) => id.startsWith("cta-")), formatCheckErrors(tutorial.errors));
  assert.ok(!ids(check(GOOD.replace("Your team gets its evenings back.", "You can sign up and try it in minutes."))).includes("cta-multiple"), "a description is not an imperative");
  // Long-form: a soft mid CTA to the same destination is allowed.
  const longText = `${GOOD.replace("Your books stay clean without a single spreadsheet.", "If you want to follow along, try Ledgerly free at ledgerly.com.")}`.replace("Try Ledgerly free today.", "Start your free trial at ledgerly.com.");
  assert.ok(!ids(checkScript({ narration: longText, duration: 30, brief: BRIEF, format: "long-form" })).some((id) => id.startsWith("cta-")));
  assert.ok(ids(checkScript({ narration: longText, duration: 30, brief: BRIEF, format: "short-form" })).includes("cta-early"));
  // --cta: the spoken action must be the requested one.
  assert.ok(ids(check(GOOD, { cta: "Book a demo at ledgerly.com" })).includes("cta-mismatch"));
  assert.ok(!ids(check(GOOD, { cta: "Try Ledgerly free" })).includes("cta-mismatch"));
  assert.ok(!ids(check(GOOD.replace("Try Ledgerly free today.", "Link in bio."))).includes("cta-missing"));
});

test("sentence-length: over 25 words is an error; a long mean is a warning", () => {
  const long = "Every payout that lands in Stripe is matched to the invoice that it pays and the customer who sent it and the day it cleared and the fee it paid.";
  assert.ok(ids(check(GOOD.replace("Your team gets its evenings back.", long))).includes("sentence-length"));
  assert.ok(!ids(check(GOOD)).includes("sentence-length"));
  assert.ok(ids(check(GOOD), "warnings").includes("mean-sentence"), "short-form budget is 10 words");
  assert.ok(!ids(check(GOOD, { format: "explainer" }), "warnings").includes("mean-sentence"));
});

test("reading-grade: Flesch-Kincaid above 7 (consumer) or 9 (B2B) warns", () => {
  const dense = "Ledgerly operationalises reconciliation. Automated categorisation eliminates discrepancies. Organisations accelerate quarterly verification. Try Ledgerly free today.";
  assert.ok(ids(checkScript({ narration: dense, duration: 15, brief: BRIEF }), "warnings").includes("reading-grade"));
  const plain = checkScript({ narration: GOOD, duration: 30, brief: BRIEF, audience: "consumer" });
  assert.ok(plain.stats.grade <= 7, String(plain.stats.grade));
  assert.equal(plain.stats.grade_max, 7);
  assert.equal(checkScript({ narration: GOOD, duration: 30, brief: { prompt: "A video for a recipe app" } }).stats.audience, "consumer");
  assert.equal(syllableCount("automatically"), 6);
  assert.equal(syllableCount("make"), 1);
  assert.equal(syllableCount("payouts"), 2);
});

test("additive-transitions: too many and/also starts warn (heuristic)", () => {
  const additive = "Payouts never match. And invoices pile up. And the close slips. Also the auditor calls. Try Ledgerly free today.";
  assert.ok(ids(checkScript({ narration: additive, duration: 12, brief: BRIEF }), "warnings").includes("additive-transitions"));
  const causal = "Payouts never match. So invoices pile up. But the close cannot slip. Because the auditor calls. Try Ledgerly free today.";
  assert.ok(!ids(checkScript({ narration: causal, duration: 12, brief: BRIEF }), "warnings").includes("additive-transitions"));
});

test("brand-first: naming the product in the hook warns for cold audiences only", () => {
  const branded = GOOD.replace("Month-end close should not take a week.", "Ledgerly ends the week-long close.");
  assert.ok(ids(check(branded, { product: "Ledgerly", awareness: "problem" }), "warnings").includes("brand-first"));
  assert.ok(!ids(check(branded, { product: "Ledgerly", awareness: "product" }), "warnings").includes("brand-first"));
  assert.ok(!ids(check(GOOD, { product: "Ledgerly", awareness: "unaware" }), "warnings").includes("brand-first"));
});

test("superlative: unbacked hype warns; a number or mechanism backs it", () => {
  assert.ok(ids(check(GOOD.replace("Your team gets its evenings back.", "It is a revolutionary way to close.")), "warnings").includes("superlative"));
  assert.ok(!ids(check(GOOD.replace("Your team gets its evenings back.", "It is seamless because it reads Stripe directly.")), "warnings").includes("superlative"));
  assert.ok(!ids(check(GOOD), "warnings").includes("superlative"));
});

test("numbers: more than one per sentence, and long decimals, warn", () => {
  const brief = { prompt: "Ledgerly", notes: ["43.7% of payouts split; 12 hours saved; 3x faster."] };
  const two = checkScript({ narration: "Payouts never match. Ledgerly saves 12 hours and runs 3x faster. Try Ledgerly free today.", duration: 10, brief });
  assert.ok(ids(two, "warnings").includes("numbers-per-sentence"));
  const precise = checkScript({ narration: "Payouts never match. 43.7% of payouts arrive split. Try Ledgerly free today.", duration: 10, brief });
  const warning = precise.warnings.find((item) => item.id === "number-precision");
  assert.ok(warning);
  assert.match(warning.fix, /about 4 in 10/);
  assert.ok(!ids(checkScript({ narration: "Payouts never match. About 4 in 10 payouts arrive split. Try Ledgerly free today.", duration: 10, brief }), "warnings").includes("number-precision"));
});

test("hook-payoff: a question in the hook should be answered late (heuristic)", () => {
  const unpaid = "Why does month-end close take a week? Ledgerly reads every payout. It matches invoices too. Your team rests. Try Ledgerly free today.";
  assert.ok(ids(checkScript({ narration: unpaid, duration: 10, brief: BRIEF }), "warnings").includes("hook-payoff"));
  const paid = "Why does month-end close take a week? Ledgerly reads every payout. It matches invoices too. Now close takes an afternoon. Try Ledgerly free today.";
  assert.ok(!ids(checkScript({ narration: paid, duration: 12, brief: BRIEF }), "warnings").includes("hook-payoff"));
});

test("inputs are validated with the valid ids named", () => {
  assert.throws(() => check(GOOD, { format: "tiktok" }), /Unknown format "tiktok"; use one of: short-form, long-form, explainer, data-explainer, story, promo/);
  assert.throws(() => check(GOOD, { goal: "sell" }), /Unknown goal/);
  assert.throws(() => check(GOOD, { awareness: "cold" }), /Unknown awareness/);
  assert.throws(() => checkScript({ narration: " " }), /needs narration/);
  assert.throws(() => check(GOOD, { duration: -1 }), /positive number/);
  assert.equal(defaultFormat(15), "short-form");
  assert.equal(defaultFormat(120), "explainer");
  assert.equal(defaultFormat(600), "long-form");
  assert.equal(check(GOOD, { format: "data-explainer" }).stats.format_source, "given");
});

test("splitSentences keeps decimals and abbreviations inside a sentence", () => {
  assert.deepEqual(splitSentences("It grew 4.5 times, e.g. in March. Then it stopped!").map((sentence) => sentence.text), ["It grew 4.5 times, e.g. in March.", "Then it stopped!"]);
  assert.equal(splitSentences("No end mark")[0].text, "No end mark");
});

test("formatCheckErrors and formatScriptCheck name the fix", () => {
  const report = check(GOOD.replace("forty per cent", "ninety per cent"));
  assert.match(formatCheckErrors(report.errors), /^1\. \[fact-trace\] "ninety per cent" is not in the brief\. Fix: Use only figures/);
  const text = formatScriptCheck(report, { label: "SCRIPT.json" });
  assert.match(text, /^launchclip script check: failed \(SCRIPT\.json\)/);
  assert.match(text, /error: \[fact-trace\]/);
  assert.match(text, /  fix: /);
});

test("options-unexplained: a named list of options nothing else explains is an error", () => {
  const empty = checkScript({ narration: "Choosing deck boards? Your choice comes down to more than colour. Timber, composite and aluminium are options to consider. The best looking board isn't always the best fit. Visit our site today.", duration: 20 });
  const error = empty.errors.find((entry) => entry.id === "options-unexplained");
  assert.ok(error, "the empty list is flagged");
  assert.match(error.message, /timber, composite, aluminium/);
  const taught = checkScript({ narration: "Choosing deck boards? Timber, composite and aluminium are the three options. Timber looks warm but needs oiling. Composite needs little upkeep but heats up in sun. Aluminium won't rot, warp or feed termites. Visit our site today.", duration: 20 });
  assert.equal(taught.errors.some((entry) => entry.id === "options-unexplained"), false);
});

test("options-unexplained: a verb list is not a list of options", () => {
  const report = checkScript({ narration: "Aluminium won't rot, warp or crack. Plan it, build it and enjoy it. Visit our site today.", duration: 12 });
  assert.equal(report.errors.some((entry) => entry.id === "options-unexplained"), false);
});

// 45 s of fast short-form: stakes, an open loop, a numbered list, a re-hook, the payoff and a comment keyword.
const STAKES = "Your new deck can rot out before its fifth summer. Three mistakes cause it, and the last one is the one nobody checks. One: the joists sit on bare soil, so water wicks straight into the timber. Two: the boards go down tight, so they cup in the first wet season. Three: the cut ends are never sealed. Every cut end drinks water like a straw. Here's the catch. All three are invisible once the deck is finished. So ask your builder about each one before the first board goes down. Comment DECK and I'll send you our checklist.";
const DECK_BRIEF = { prompt: "Three mistakes that rot a new deck. Offer: our checklist." };

test("hedging: two hedges in a short video are an error, one a warning; a long video is not checked", () => {
  const hedged = STAKES.replace("so water wicks straight into the timber", "which can help water reach the timber").replace("so they cup", "so they may need replacing and cup");
  const report = checkScript({ narration: hedged, duration: 45, brief: DECK_BRIEF, ctaKeyword: "deck" });
  assert.ok(ids(report).includes("hedging"));
  assert.match(report.errors.find((item) => item.id === "hedging").message, /"can help", "may need"/);
  const once = checkScript({ narration: STAKES.replace("so they cup", "so they may need replacing and cup"), duration: 45, brief: DECK_BRIEF, ctaKeyword: "deck" });
  assert.ok(!ids(once).includes("hedging"));
  assert.ok(ids(once, "warnings").includes("hedge"));
  assert.ok(!ids(checkScript({ narration: hedged, duration: 300, brief: DECK_BRIEF, format: "long-form" }), "warnings").includes("hedge"));
});

test("a short video over 30 s should open a loop and re-hook mid-way (warnings)", () => {
  const clean = checkScript({ narration: STAKES, duration: 45, brief: DECK_BRIEF, ctaKeyword: "deck" });
  assert.deepEqual(ids(clean), [], formatScriptCheck(clean));
  assert.ok(!ids(clean, "warnings").includes("open-loop"));
  assert.ok(!ids(clean, "warnings").includes("rehook-missing"));
  const flat = STAKES.replace(", and the last one is the one nobody checks", "").replace("Here's the catch. ", "").replace("Every cut end drinks water like a straw.", "Every cut end drinks water through the grain all year long.");
  const report = checkScript({ narration: flat, duration: 45, brief: DECK_BRIEF });
  assert.ok(ids(report, "warnings").includes("open-loop"));
  assert.ok(ids(report, "warnings").includes("rehook-missing"));
});

test("cta-keyword and cta-choice: the host's keyword or the series' options are asked for at the end", () => {
  assert.ok(!ids(checkScript({ narration: STAKES, duration: 45, brief: DECK_BRIEF, ctaKeyword: "DECK" })).includes("cta-keyword"));
  const other = checkScript({ narration: STAKES, duration: 45, brief: DECK_BRIEF, ctaKeyword: "boards" });
  assert.ok(ids(other).includes("cta-keyword"));
  assert.match(other.errors.find((item) => item.id === "cta-keyword").fix, /Comment BOARDS/);
  // "Comment WORD" is a comment call to action, not a missing one.
  assert.deepEqual(checkScript({ narration: STAKES, duration: 45, brief: DECK_BRIEF }).stats.ctas.map((cta) => cta.class), ["comment"]);
  const choice = "Rosa deals blackjack. Lou lifts wallets. Ike wired the cameras. Who joins the crew? Comment Rosa, Lou or Ike. One word.";
  assert.ok(!ids(checkScript({ narration: choice, duration: 20, choices: ["ROSA", "LOU", "IKE"] })).includes("cta-choice"));
  const short = checkScript({ narration: choice.replace(" or Ike", ""), duration: 20, choices: "ROSA,LOU,IKE" });
  assert.ok(ids(short).includes("cta-choice"));
  assert.match(short.errors.find((item) => item.id === "cta-choice").message, /missing IKE/);
});
