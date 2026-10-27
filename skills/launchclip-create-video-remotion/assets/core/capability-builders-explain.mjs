// Beat-director params builders: Explainer data, calendars, people and maths (catalog-i-explain.mjs).
//
// The director picks a capability for a clause and asks for its params
// (capabilityParams in visual-capabilities.mjs). A builder maps the beat to
// the module's own params contract (skills-src/references/storyboard-modules.md),
// or returns null when the beat cannot fill the module honestly; the director
// then walks the capability's fallback chain. A module with no builder here is
// `planned` (isPlanned) and always falls back.
//
// Modules: small-multiples, date-carousel, month-grid, lineage-graph, equation, title-decompose.
//
// A beat is {id, text, headline, label?, sub?, kicker?, brand?, facts: {numbers,
// items, dates, quote, sides, places}, evidence?: {claim, status, source, quote?,
// capture?: {id, kind, out}, data?}}. evidence.data is the module-ready data the
// research and capture stages attach to a claim or capture:
//   series: {panels: [{title, series: [{label, value}]}], source}; people: {people: [{name, role?, photo?, links?}]}; equation: {tex, svg?} from src/ precompute; title: {title, terms: [{text, gloss, icon?}]}
// Evidence modules must never invent content: no evidence.data, no params.
//
// h: the shared helpers from visual-capabilities.mjs (clip, keyTerms,
// numbersOf, itemsOf, percentOf, seriesOf, sidesOf, timelineSteps, quoteOf,
// excerptLines, formatValue, sourceOf, iconFor, round).
//
// Pure ESM, no imports. Canonical copy: kit/core/capability-builders-explain.mjs.

//
// What each builder needs (else null, and the director falls back):
//   small-multiples  evidence.data.panels (or .series.panels): 2–6 panels that
//                    share 2–4 series labels.
//   date-carousel    two full dates: the clause's month-day dates with a year
//                    from the clause, or evidence.data.dates; with one, the
//                    evidence source's own date is the other end.
//   month-grid       a run: a full date and "N days" in the clause, or a month
//                    and a year (the whole month), or evidence.data {from, days}.
//   lineage-graph    evidence.data.people with their links (no links, no graph).
//   equation         evidence.data.tex and its typeset block (src/math/typeset.js
//                    output, as .typeset or .svg); kit/core cannot typeset.
//   title-decompose  evidence.data.title and terms that are runs of its words.

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;
const leap = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysIn = (year, month) => (month === 2 && leap(year) ? 29 : MONTH_DAYS[month - 1]);
const dayNumber = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const validIso = (value) => { const m = ISO.exec(String(value ?? '')); return Boolean(m) && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= daysIn(Number(m[1]), Number(m[2])); };
const isoPart = (value) => String(value ?? '').slice(0, 10);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/** evidence.data, and a named part of it when the research stage nests it ({people: {people: […]}}). */
function dataOf(beat, key) {
  const data = beat.evidence?.data;
  if (!data || typeof data !== 'object') return null;
  const part = data[key];
  return part && typeof part === 'object' && !Array.isArray(part) ? { ...data, ...part } : data;
}

/** The clause's full dates, in order: month-day dates with the clause's year, or evidence.data.dates. */
function fullDates(beat) {
  const listed = dataOf(beat, 'dates')?.dates;
  if (Array.isArray(listed)) {
    const out = listed.map((entry) => (typeof entry === 'string' ? { iso: isoPart(entry) } : { iso: isoPart(entry?.date), label: entry?.label })).filter((entry) => validIso(entry.iso));
    if (out.length) return out;
  }
  const dates = beat.facts?.dates ?? [];
  const years = dates.filter((entry) => entry.year && !entry.month).map((entry) => entry.year);
  const days = dates.filter((entry) => entry.month && entry.day);
  if (!days.length || !years.length) return [];
  // One year for every day, or a year for each day in order.
  const yearOf = (i) => (years.length === days.length ? years[i] : years.length === 1 ? years[0] : null);
  return days.map((entry, i) => ({ iso: yearOf(i) ? isoOf(yearOf(i), entry.month, entry.day) : null, label: entry.label })).filter((entry) => validIso(entry.iso));
}

// Sample beats for the "every params builder resolves" test: each carries the
// dates or evidence.data its builder needs. The equation's typeset block is
// src/math/typeset.js output for "\\term{x}^2", inlined because this file
// imports nothing.
const SOURCE = { url: 'https://example.com/report', title: 'Lab report', date: '2026-10-24' };
const evidence = (data) => ({ claim: 'c-sample', status: 'verified', source: SOURCE, data });
const SAMPLE_TEX = '\\term{x}^2';
const SAMPLE_TYPESET = {"v":1,"latex":"\\term{x}^2","viewBox":[0,-883.9,1008.6,894.9],"glyphs":{"I-1D465":"M52 289Q59 331 106 386T222 442Q257 442 286 424T329 379Q371 442 430 442Q467 442 494 420T522 361Q522 332 508 314T481 292T458 288Q439 288 427 299T415 328Q415 374 465 391Q454 404 425 404Q412 404 406 402Q368 386 350 336Q290 115 290 78Q290 50 306 38T341 26Q378 26 414 59T463 140Q466 150 469 151T485 153H489Q504 153 504 145Q504 144 502 134Q486 77 440 33T333 -11Q263 -11 227 52Q186 -10 133 -10H127Q78 -10 57 16T35 71Q35 103 54 123T99 143Q142 143 142 101Q142 81 130 66T107 46T94 41L91 40Q91 39 97 36T113 29T132 26Q168 26 194 71Q203 87 217 139T245 247T261 313Q266 340 266 352Q266 380 251 392T217 404Q177 404 142 372T93 290Q91 281 88 280T72 278H58Q52 284 52 289Z","N-32":"M109 429Q82 429 66 447T50 491Q50 562 103 614T235 666Q326 666 387 610T449 465Q449 422 429 383T381 315T301 241Q265 210 201 149L142 93L218 92Q375 92 385 97Q392 99 409 186V189H449V186Q448 183 436 95T421 3V0H50V19V31Q50 38 56 46T86 81Q115 113 136 137Q145 147 170 174T204 211T233 244T261 278T284 308T305 340T320 369T333 401T340 431T343 464Q343 527 309 573T212 619Q179 619 154 602T119 569T109 550Q109 549 114 549Q132 549 151 535T170 489Q170 464 154 447T109 429Z"},"layers":[{"kind":"base","items":[{"g":"N-32","m":[0.707,0,0,-0.707,605,-413]}]},{"kind":"term","items":[{"g":"I-1D465","m":[1,0,0,-1,0,0]}]}],"boxes":[[35,-442,522,11]]};
const SAMPLES = Object.freeze([
  { id: 'sample-multiples', text: 'It leads on every benchmark in the card.', headline: 'Leads on every benchmark', facts: { numbers: [], dates: [], items: [] },
    evidence: evidence({ panels: ['Coding', 'Science', 'Agents'].map((title, i) => ({ title, series: [{ label: 'Model A', value: 60 + i }, { label: 'Model B', value: 55 + 2 * i }] })), source: 'Model card, table 4' }) },
  { id: 'sample-carousel', text: 'It started on October 5 2026, three weeks before the launch on October 26.', headline: 'Where it started', label: 'Beta', facts: { numbers: [], items: [], dates: [{ label: '2026', year: 2026 }, { label: 'Oct 5', month: 10, day: 5 }, { label: 'Oct 26', month: 10, day: 26 }] } },
  { id: 'sample-month', text: 'From October 5 2026 the team shipped every day for 28 days.', headline: 'Shipping daily', facts: { numbers: [{ value: 28, raw: '28', label: 'days' }], items: [], dates: [{ label: '2026', year: 2026 }, { label: 'Oct 5', month: 10, day: 5 }] } },
  { id: 'sample-lineage', text: 'Her doctoral advisor was Ana Ruiz.', headline: 'Trained under Ana Ruiz', facts: { numbers: [], dates: [], items: [] },
    evidence: evidence({ people: [{ name: 'Ana Ruiz', role: 'Doctoral advisor', links: [{ to: 'Sam Okafor', label: 'doctoral advisor' }] }, { name: 'Sam Okafor', role: 'Ph.D. 2008' }] }) },
  { id: 'sample-equation', text: 'The area grows with the square of the side.', headline: 'Area and side', facts: { numbers: [], dates: [], items: [] }, evidence: evidence({ tex: SAMPLE_TEX, typeset: SAMPLE_TYPESET }) },
  { id: 'sample-title', text: 'The paper\'s title says it all.', headline: 'The paper\'s title', facts: { numbers: [], dates: [], items: [] },
    evidence: evidence({ title: 'Quantum Gravity Corrections to the One Loop Scalar Self-Mass', terms: [{ text: 'Quantum Gravity', gloss: 'Quantum gravity', icon: 'atom' }, { text: 'Self-Mass', gloss: 'the field\'s own mass' }] }) }
]);

/**
 * → {builders: {[module]: (beat) => params | null}, additions: {[module]: (beat) => {key, items}},
 *    samples: [beat]}: samples are test beats carrying the evidence.data these
 *    builders need; test/visual_capabilities.test.js resolves every builder against
 *    them, so an evidence-only builder is checked without inventing data elsewhere.
 */
export function explainBuilders(h) {
  const { clip, keyTerms, sourceOf } = h;
  const title = (beat) => (nonEmpty(beat.headline) ? clip(beat.headline, 60) : undefined);
  const source = (beat, data) => (nonEmpty(data?.source) ? clip(data.source, 80) : sourceOf(beat));

  // small-multiples: the panels must share their series, in the same order.
  function multiples(beat) {
    const data = dataOf(beat, 'series');
    const panels = Array.isArray(data?.panels) ? data.panels.filter((panel) => nonEmpty(panel?.title) && Array.isArray(panel.series)) : [];
    if (panels.length < 2) return null;
    const labels = panels[0].series.map((entry) => entry?.label).filter(nonEmpty);
    if (labels.length < 2 || labels.length > 4) return null;
    const rows = panels.slice(0, 6).map((panel) => ({ title: clip(panel.title, 24), values: labels.map((label) => panel.series.find((entry) => entry?.label === label)?.value) }));
    if (rows.some((row) => row.values.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0))) return null;
    return { series: labels.map((label) => clip(label, 20)), panels: rows, title: title(beat), source: source(beat, data) };
  }

  // date-carousel: rewind (or run on) from one real date to another.
  function carousel(beat) {
    const dates = fullDates(beat);
    let from, to;
    if (dates.length >= 2) { from = dates[dates.length - 1]; to = dates[0]; }
    else if (dates.length === 1 && validIso(isoPart(beat.evidence?.source?.date))) { from = { iso: isoPart(beat.evidence.source.date) }; to = dates[0]; }
    else return null;
    const span = Math.abs(dayNumber(from.iso) - dayNumber(to.iso));
    if (!span || span > 120) return null;
    const label = beat.label ?? keyTerms(beat.headline ?? beat.text)[0];
    return { from: from.iso, to: to.iso, title: title(beat), ...(nonEmpty(label) ? { event: { label: clip(label, 12) } } : {}), ...(nonEmpty(beat.sub) ? { caption: clip(beat.sub, 40) } : {}) };
  }

  // month-grid: a run of days, or the whole of a named month.
  function month(beat) {
    const data = dataOf(beat, 'run');
    if (validIso(isoPart(data?.from)) && Number.isInteger(data?.days) && data.days >= 1 && data.days <= 42) return { from: isoPart(data.from), days: data.days, title: title(beat) };
    const run = (beat.facts?.numbers ?? []).find((entry) => (/^days?$/.test(entry.unit ?? '') || /^days?\b/.test(entry.label ?? '')) && Number.isInteger(entry.value) && entry.value >= 1 && entry.value <= 42);
    const start = fullDates(beat)[0];
    if (run && start) return { from: start.iso, days: run.value, title: title(beat) };
    const dates = beat.facts?.dates ?? [];
    const named = dates.find((entry) => entry.month && !entry.day), year = dates.find((entry) => entry.year && !entry.month)?.year;
    if (named && year) return { from: isoOf(year, named.month, 1), days: daysIn(year, named.month), title: title(beat) };
    return null;
  }

  // lineage-graph: only the real people the evidence names, linked as it links them.
  function lineage(beat) {
    const data = dataOf(beat, 'people');
    const people = Array.isArray(data?.people) ? data.people.filter((person) => nonEmpty(person?.name)).slice(0, 5) : [];
    if (people.length < 2 || people.some((person) => person.name.trim().length > 24)) return null;
    const index = (ref) => (Number.isInteger(ref) ? (ref >= 0 && ref < people.length ? ref : -1) : people.findIndex((person) => person.name === ref || person.id === ref));
    const raw = [...(Array.isArray(data.links) ? data.links : []), ...people.flatMap((person, i) => (Array.isArray(person.links) ? person.links.map((link) => ({ from: i, ...link })) : []))];
    const links = [];
    for (const link of raw) {
      const from = index(link?.from), to = index(link?.to);
      if (from < 0 || to < 0 || from === to || links.some((l) => l.from === from && l.to === to)) continue;
      links.push({ from, to, ...(nonEmpty(link.label ?? link.role) ? { label: clip(link.label ?? link.role, 24) } : {}) });
    }
    if (!links.length) return null;
    return { people: people.map((person) => ({ name: person.name.trim(), ...(nonEmpty(person.role) ? { role: clip(person.role, 28) } : {}), ...(nonEmpty(person.photo) && person.photo.startsWith('assets/') ? { image: person.photo } : {}) })),
      links: links.slice(0, 6), title: title(beat), source: source(beat, data) };
  }

  // equation: the evidence's LaTeX with its precomputed typeset block.
  function equation(beat) {
    const data = dataOf(beat, 'equation');
    const latex = data?.tex ?? data?.latex;
    if (!nonEmpty(latex) || latex.length > 400) return null;
    const typeset = [data.typeset, data.svg].find((block) => block && typeof block === 'object' && block.v === 1 && block.latex === latex && !block.error);
    return typeset ? { latex, typeset, title: title(beat), source: source(beat, data) } : null;
  }

  // title-decompose: the title as written, glossed only where the evidence glosses it.
  function decompose(beat) {
    const data = dataOf(beat, 'title');
    const text = typeof data?.title === 'string' ? data.title.trim() : null;
    if (!text || text.length > 120 || !Array.isArray(data.terms)) return null;
    const words = text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, ''));
    const inTitle = (term) => { const want = term.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}-]/gu, '')); return words.some((_, k) => want.every((w, j) => words[k + j] === w)); };
    const terms = data.terms.filter((term) => nonEmpty(term?.text) && nonEmpty(term?.gloss) && inTitle(term.text)).slice(0, 5)
      .map((term) => ({ text: term.text.trim(), gloss: clip(term.gloss, 24), ...(nonEmpty(term.sub) ? { sub: clip(term.sub, 28) } : {}), ...(nonEmpty(term.icon) ? { icon: term.icon } : {}) }));
    if (!terms.length) return null;
    const citation = source(beat, data);
    return { text, terms, ...(citation ? { citation } : {}) };
  }

  return {
    builders: { 'small-multiples': multiples, 'date-carousel': carousel, 'month-grid': month, 'lineage-graph': lineage, equation, 'title-decompose': decompose },
    // One more clause adds its own panels to a dashboard on screen, when they share its series.
    additions: { 'small-multiples': (beat) => ({ key: 'panels', items: multiples(beat)?.panels ?? [] }) },
    samples: SAMPLES
  };
}
