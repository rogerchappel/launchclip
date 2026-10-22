// Catalogue B module `archive-card`: params → model (resolve), model → static
// element tree (view) and renderer-neutral animation ops (timeline).
// Registered in kit/core/catalog-b.mjs; conventions are documented there.

import {CATALOG_B_STYLE, alphaHex, createBase, fitText, mixColor, r2, rt, textWidth, timingRules} from './catalog-b-base.mjs';
import {abs, el, set, text, transformString, tw} from './catalog-b-view.mjs';
import {grammarStagger} from './grammar.mjs';

const at = 'seconds from scene start (optional; else a matching hit, else a default)';
const rect = '{x, y, width, height} canvas px inside the safe zone (optional)';

// ---------------------------------------------------------------------------
// Model

function resolve(params, ctx) {
  const b = createBase('archive-card', params, ctx, {allowed: ['quote', 'title', 'source', 'date', 'stamp', 'image', 'reveal_at', 'kicker'], required: ['source'], hidesCaptions: true});
  const {check, u, rect, id, start, theme, colors} = b;
  const p = b.params;
  if (p.quote === undefined && p.title === undefined) check.fail('params', 'needs a quote or a title');
  const quote = p.quote === undefined ? null : check.str(p.quote, 'params.quote', 160);
  const title = p.title === undefined ? null : check.str(p.title, 'params.title', 60);
  const source = check.str(p.source, 'params.source', 80);
  const date = p.date === undefined ? null : check.str(String(p.date), 'params.date', 24);
  const kicker = p.kicker === undefined ? 'ARCHIVE' : check.str(p.kicker, 'params.kicker', 20).toUpperCase();
  const image = p.image === undefined ? null : check.asset(p.image, 'params.image');
  let stamp = null;
  if (p.stamp !== false && (p.stamp !== undefined || date)) {
    const raw = p.stamp === undefined ? {text: date} : typeof p.stamp === 'string' ? {text: p.stamp} : check.obj(p.stamp, 'params.stamp', ['text', 'at'], ['text']);
    stamp = {text: check.str(String(raw.text), 'params.stamp.text', 14).toUpperCase(), at: raw.at};
  }
  // Paper card: ink on paper; the stamp is primary with ink lettering.
  const paperInk = colors.ink, card = colors.paper;
  b.requireContrast('ink/paper', paperInk, card, 'brand.colors.ink on brand.colors.paper');
  const sourceColor = mixColor(paperInk, card, 0.72);
  b.requireContrast('source/paper', sourceColor, card, 'source line (ink at 72% over paper)');
  b.requireContrast('ink/primary', paperInk, colors.primary, 'brand.colors.ink on brand.colors.primary (stamp)');

  const W = rect.width, pad = u(56), innerW = W - u(40) - pad * 2;
  const kickerSize = r2(u(26));
  const metaText = date ? `${kicker} · ${date}` : kicker;
  let y = pad;
  const metaY = y; y += kickerSize * 1.3 + u(26);
  const ruleTop = r2(y); y += u(30);
  let imageBox = null;
  if (image) { imageBox = {x: pad, y: r2(y), width: r2(innerW), height: r2(u(300))}; y += u(300) + u(30); }
  let titleFit = null, titleY = null;
  if (title) {
    titleFit = fitText(check, 'params.title', title, {family: 'display', width: innerW, preferred: u(84), min: u(56), maxLines: 2});
    titleY = r2(y); y += titleFit.lines * titleFit.size * 1.05 + u(24);
  }
  let quoteFit = null, quoteY = null, words = [];
  const revealDefault = b.motion.enterDuration + 0.15;
  const revealTime = b.timeOf('quote', p.reveal_at, 'params.reveal_at', revealDefault);
  if (quote) {
    const text = `“${quote}”`;
    quoteFit = fitText(check, 'params.quote', text, {family: 'serif', width: innerW, preferred: u(image ? 50 : 60), min: b.min.key, maxLines: image ? 4 : 6});
    quoteY = r2(y); y += quoteFit.lines * quoteFit.size * 1.28 + u(28);
    const split = text.split(/\s+/).filter(Boolean);
    const each = grammarStagger(ctx.grammar, Math.min(0.07, 1.4 / split.length), {max: 0.12});
    words = split.map((word, i) => ({text: word, time: rt(revealTime + i * each)}));
  }
  const ruleBottom = r2(y); y += u(28);
  const sourceSize = r2(u(34));
  const sourceFit = fitText(check, 'params.source', `— ${source}`, {family: 'body', width: innerW - (stamp ? u(200) : 0), preferred: sourceSize, min: b.min.meta + u(4), maxLines: 2});
  const sourceY = r2(y); y += sourceFit.lines * sourceFit.size * 1.3 + pad;
  const cardH = r2(y);
  if (cardH > rect.height - u(40)) check.fail('params', `card is ${Math.round(cardH)} px tall but only ${Math.round(rect.height - u(40))} px fit; shorten the quote or drop the image`);
  // Centre the card on the Shorts centre of mass (y 860 at 1920), within rect.
  const centre = b.portrait ? b.canvas.height * 860 / 1920 : rect.y + rect.height / 2;
  const cardY = r2(Math.min(Math.max(centre - cardH / 2 - rect.y, 0), rect.height - cardH - u(40)));
  const cardBox = {x: r2(u(20)), y: cardY, width: r2(W - u(40)), height: cardH, rotation: -1.6, radius: r2(u(10))};
  const quoteEnd = words.length ? words[words.length - 1].time + 0.35 : revealTime + 0.35;
  let stampModel = null;
  if (stamp) {
    const time = b.timeOf('stamp', stamp.at, 'params.stamp.at', Math.min(b.lastEvent, quoteEnd + 0.35 - start));
    const size = fitText(check, 'params.stamp.text', stamp.text, {family: 'display', width: u(360), preferred: u(76), min: b.min.key}).size;
    const w = r2(textWidth(stamp.text, size, 'display') + u(64)), h = r2(size * 1.1 + u(44));
    stampModel = {text: stamp.text, size, width: w, height: h, x: r2(cardBox.x + cardBox.width - w * 0.86), y: r2(cardBox.y + cardBox.height - h * 0.78), rotation: -11, fromRotation: -24, fromScale: 2.6,
      time, duration: 0.2, ease: 'power4.in', endTime: rt(time + 0.2), thudTime: rt(time + 0.2), thud: r2(u(10)), ringTime: rt(time + 0.18), border: r2(u(5))};
    if (stampModel.y + stampModel.height > rect.height) check.fail('params.stamp', 'does not fit below the card; shorten the quote');
    b.events.push({id: `${id}-stamp`, name: 'stamp', time, endTime: stampModel.endTime, role: 'impact', cue: 'impact'});
  }
  b.events.push({id: `${id}-quote`, name: 'quote', time: revealTime, endTime: rt(quoteEnd), role: 'reveal'});
  const content = {card: cardBox, paper: card, ink: paperInk, sourceColor, rule: alphaHex(paperInk, 0.35), lines: alphaHex(paperInk, 0.04), pad,
    meta: {text: metaText, size: kickerSize, y: r2(metaY)}, ruleTop, ruleBottom, image: imageBox ? {src: image, ...imageBox} : null,
    title: titleFit ? {text: title, size: titleFit.size, y: titleY} : null,
    quote: quoteFit ? {size: quoteFit.size, y: quoteY, words, wordDuration: 0.32} : null,
    source: {text: `— ${source}`, size: sourceFit.size, y: sourceY, width: r2(innerW - (stamp ? u(200) : 0))}, stamp: stampModel,
    serif: CATALOG_B_STYLE.serif, innerWidth: r2(innerW)};
  return b.finish(content, {minTextPx: Math.min(quoteFit ? quoteFit.size : Infinity, titleFit ? titleFit.size : Infinity, stampModel ? stampModel.size : Infinity)});
}

// ---------------------------------------------------------------------------
// View

function view(model) {
  const {id, theme, fonts, unit: u} = model;
  const c = model.content;
  const C = c.card;
  const kids = [];
  const card = [];
  card.push(el('div', null, abs(18 * u, 18 * u, C.width - 36 * u, C.height - 36 * u, {boxSizing: 'border-box', border: `${2 * u}px solid ${c.rule}`, borderRadius: C.radius * 0.6})));
  card.push(text(null, abs(c.pad, c.meta.y, undefined, undefined, {fontFamily: fonts.meta, fontSize: c.meta.size, lineHeight: '1.3', letterSpacing: '0.14em', color: c.sourceColor}), c.meta.text));
  card.push(el('div', null, abs(c.pad, c.ruleTop, c.innerWidth, 2 * u, {background: c.rule})));
  if (c.image) card.push(el('img', null, abs(c.image.x, c.image.y, c.image.width, c.image.height, {objectFit: 'cover', filter: 'grayscale(1) sepia(0.35) contrast(1.05)', boxSizing: 'border-box', border: `${2 * u}px solid ${c.rule}`}), [], {src: c.image.src, alt: ''}));
  if (c.title) card.push(el('div', null, abs(c.pad, c.title.y, c.innerWidth, undefined, {margin: 0, fontFamily: fonts.display, fontSize: c.title.size, lineHeight: '1.05', color: c.ink, textTransform: 'none'}), [c.title.text]));
  if (c.quote) {
    const words = [];
    c.quote.words.forEach((w, i) => {
      if (i) words.push(' ');
      words.push(el('span', `${id}-word-${i}`, {display: 'inline-block', opacity: 0, transform: transformString({y: 12 * u})}, [w.text]));
    });
    card.push(el('div', null, abs(c.pad, c.quote.y, c.innerWidth, undefined, {margin: 0, fontFamily: c.serif, fontStyle: 'italic', fontSize: c.quote.size, lineHeight: '1.28', color: c.ink}), words));
  }
  card.push(el('div', null, abs(c.pad, c.ruleBottom, c.innerWidth, 2 * u, {background: c.rule})));
  card.push(el('div', null, abs(c.pad, c.source.y, c.source.width, undefined, {margin: 0, fontFamily: fonts.body, fontWeight: 500, fontSize: c.source.size, lineHeight: '1.3', color: c.sourceColor}), [c.source.text]));
  kids.push(el('div', `${id}-card`, abs(C.x, C.y, C.width, C.height, {boxSizing: 'border-box', borderRadius: C.radius, backgroundColor: c.paper,
    backgroundImage: `repeating-linear-gradient(0deg, ${c.lines} 0px, ${c.lines} ${2 * u}px, transparent ${2 * u}px, transparent ${9 * u}px)`,
    boxShadow: `0 ${30 * u}px ${80 * u}px #000000b3, 0 ${4 * u}px ${12 * u}px #00000066`, transform: transformString({rotation: C.rotation}), transformOrigin: '50% 50%'}), card));
  if (c.stamp) {
    const S = c.stamp;
    const ring = 14 * u;
    kids.push(el('div', `${id}-stamp-ring`, abs(S.x - ring, S.y - ring, S.width + ring * 2, S.height + ring * 2, {boxSizing: 'border-box', borderRadius: 14 * u, border: `${4 * u}px solid ${theme.primary}`, opacity: 0, transform: transformString({rotation: S.rotation})})));
    kids.push(el('div', `${id}-stamp`, abs(S.x, S.y, S.width, S.height, {boxSizing: 'border-box', borderRadius: 8 * u, background: theme.primary,
      boxShadow: `inset 0 0 0 ${S.border}px ${theme.ink}, inset 0 0 0 ${S.border * 2}px ${theme.primary}, inset 0 0 0 ${S.border * 2.6}px ${theme.ink}, 0 ${10 * u}px ${30 * u}px #00000080`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transform: transformString({rotation: S.fromRotation, scaleX: S.fromScale, scaleY: S.fromScale})}), [
      text(null, {fontFamily: fonts.display, fontSize: S.size, lineHeight: '1.1', color: theme.ink, letterSpacing: '0.04em'}, S.text)
    ]));
  }
  return kids;
}

// ---------------------------------------------------------------------------
// Timeline

function timeline(model, ops) {
  const {id, start, unit: u} = model;
  const c = model.content;
  set(ops, `${id}-card`, start, {x: 0, y: 0, rotation: c.card.rotation, scaleX: 1, scaleY: 1});
  if (c.quote) c.quote.words.forEach((w, i) => {
    set(ops, `${id}-word-${i}`, start, {opacity: 0, x: 0, y: 12 * u, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-word-${i}`, w.time, c.quote.wordDuration, 'power2.out', {opacity: 0, y: 12 * u}, {opacity: 1, y: 0});
  });
  if (c.stamp) {
    const S = c.stamp;
    set(ops, `${id}-stamp`, start, {opacity: 0, x: 0, y: 0, rotation: S.fromRotation, scaleX: S.fromScale, scaleY: S.fromScale});
    tw(ops, `${id}-stamp`, S.time, 0.08, 'power1.in', {opacity: 0}, {opacity: 1});
    tw(ops, `${id}-stamp`, S.time, S.duration, S.ease, {rotation: S.fromRotation, scaleX: S.fromScale, scaleY: S.fromScale}, {rotation: S.rotation, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-card`, S.thudTime, 0.06, 'power2.out', {y: 0}, {y: S.thud});
    tw(ops, `${id}-card`, S.thudTime + 0.06, 0.32, 'power2.out', {y: S.thud}, {y: 0});
    set(ops, `${id}-stamp-ring`, start, {opacity: 0, x: 0, y: 0, rotation: S.rotation, scaleX: 1, scaleY: 1});
    tw(ops, `${id}-stamp-ring`, S.ringTime, 0.05, 'none', {opacity: 0}, {opacity: 0.8});
    tw(ops, `${id}-stamp-ring`, S.ringTime + 0.05, 0.5, 'power2.out', {opacity: 0.8, scaleX: 1, scaleY: 1}, {opacity: 0, scaleX: 1.35, scaleY: 1.6});
  }
}

export const archiveCard = {
  id: 'archive-card',
    describe: 'A historical paper plate or quote card with a source line, date and a stamp that slams in. Hides captions.',
    params: {quote: 'string ≤ 160 (quote or title required)', title: 'string ≤ 60', source: 'string ≤ 80 (required)', date: 'string ≤ 24, e.g. "1701"',
      stamp: 'string | {text, at?} | false (default: the date)', kicker: 'string ≤ 20 (default "ARCHIVE")', image: 'assets/… local image (optional)', reveal_at: at, rect},
    events: ['quote', 'stamp'],
    timing: timingRules({rules: ['stamp.at defaults to 0.35 s after the quote finishes revealing']}),
  resolve,
  view,
  timeline
};
