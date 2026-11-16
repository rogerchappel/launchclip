// End-card layouts, type-led family: the words are the design
// (docs/END_CARDS_RFC.md §5.1). Each layout: {id, family, grounds, actions,
// tags, needs, logo?, build(k)}; build draws with the kit in
// kit/core/catalog-b-end-card.mjs and returns the ground (a hex or 'footage').
// Geometry is rect-local px: k.W × k.H is the safe area, k.full the canvas.

import {el, abs} from './catalog-b-view.mjs';

const r2 = v => Math.round(v * 100) / 100;
/** Tops for blocks of `heights` stacked with `gap`, centred in [top, top + span]. */
export function stack(heights, gap, top, span) {
  const total = heights.reduce((s, h) => s + h, 0) + gap * Math.max(0, heights.length - 1);
  let y = top + Math.max(0, (span - total) / 2);
  return heights.map(h => { const at = r2(y); y += h + gap; return at; });
}
/** The address split at its first dot: ['harleybuilt', '.au']. */
export const splitDomain = url => { const i = url.indexOf('.'); return i > 0 ? [url.slice(0, i), url.slice(i)] : [url, '']; };
/** A colour for type on `ground` that keeps `prefer` when it reads (3:1 for big type). */
export const bigInk = (k, prefer, ground) => (k.on(ground, prefer) === prefer ? prefer : k.on(ground));
/** The action line for the ask, from whatever the ending has. */
export const askLine = f => f.url ?? f.handle ?? (f.keyword ? `Comment ${f.keyword}` : f.slot ?? '');

export const TYPE_LAYOUTS = [
  {
    id: 'sign-off', family: 'type-led', grounds: ['paper', 'card'], actions: ['save', 'follow', 'url'], tags: ['calm', 'premium', 'editorial'], needs: ['headline'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('paper');
      const ink = k.on(ground, c.ink);
      const logoH = u(150), ask = f.url ?? f.handle;
      const head = {width: W * 0.96, preferred: 150, maxLines: 4, lineHeight: 1.08};
      const fit = k.measure(f.headline, head);
      const blocks = [k.hasLogo ? ['logo', logoH] : null, ['head', fit.height], ['rule', u(2)], ask ? ['ask', u(44)] : null].filter(Boolean);
      const tops = Object.fromEntries(blocks.map(([name], i) => [name, stack(blocks.map(([, h]) => h), u(60), 0, H)[i]]));
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: tops.logo, h: logoH, align: 'center', ground}, {kind: 'rise', beat: 0});
      k.text('headline', f.headline, {...head, x: W * 0.02, y: tops.head, color: ink, align: 'center', italic: true}, {kind: 'rise', beat: 1});
      const yRule = tops.rule, yAsk = tops.ask;
      k.node('div', 'rule', abs(W / 2 - u(60), yRule, u(120), u(2), {background: ink, opacity: 0.5}), [], undefined, {kind: 'wipe', beat: 2});
      if (ask) k.text('ask', ask.toUpperCase(), {x: 0, y: yAsk, width: W, family: 'meta', preferred: 40, maxLines: 1, color: bigInk(k, c.primary, ground), align: 'center', spacing: 0.3, meta: true}, {kind: 'rise', beat: 3});
      return ground;
    }
  },
  {
    id: 'url-hero', family: 'type-led', grounds: ['card', 'footage'], actions: ['url'], tags: ['loud', 'technical'], needs: ['url'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('card');
      const [name, domain] = splitDomain(f.url);
      const lead = f.headline ?? f.reason ?? 'Find it at';
      const top = H * 0.36;
      const leadText = k.text('lead', lead, {x: 0, y: top, width: W, family: 'body', preferred: 56, maxLines: 2, lineHeight: 1.25, color: k.on(ground), style: {opacity: 0.78}}, {kind: 'rise', beat: 0});
      const hero = k.text('url', name, {x: 0, y: top + leadText.height + u(40), width: W, preferred: 300, maxLines: 1, lineHeight: 0.9, color: bigInk(k, c.primary, ground), upper: false, spacing: -0.02}, {kind: 'rise', beat: 1});
      if (domain) k.text('domain', domain, {x: 0, y: top + leadText.height + u(40) + hero.height, width: W, preferred: hero.size / k.u(1), maxLines: 1, lineHeight: 0.9, color: k.on(ground)}, {kind: 'rise', beat: 2});
      if (k.hasLogo) k.logo('logo', {x: 0, y: H - u(120), h: u(120), ground}, {kind: 'fade', beat: 3});
      return ground;
    }
  },
  {
    id: 'handle-hero', family: 'type-led', grounds: ['footage', 'card'], actions: ['follow'], tags: ['loud', 'playful'], needs: ['handle'],
    build(k) {
      const {W, H, u, fields: f, full} = k;
      const ground = k.ground('footage');
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: '#0a0a0a8c'}));
      const ink = '#ffffff';
      const lead = f.reason ? `Follow for ${f.reason}` : 'Follow along';
      const leadText = k.text('lead', lead, {x: 0, y: H * 0.36, width: W, family: 'body', preferred: 50, maxLines: 2, lineHeight: 1.25, color: ink}, {kind: 'rise', beat: 0});
      k.text('handle', f.handle, {x: 0, y: H * 0.36 + leadText.height + u(28), width: W, preferred: 190, maxLines: 2, lineHeight: 0.98, color: ink}, {kind: 'rise', beat: 1});
      if (k.hasLogo) k.logo('logo', {x: 0, y: 0, h: u(120), ground}, {kind: 'fade', beat: 2});
      return ground;
    }
  },
  {
    id: 'keyword-ticket', family: 'type-led', grounds: ['card', 'paper', 'footage'], actions: ['keyword'], tags: ['playful', 'loud'], needs: ['keyword', 'offer'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('card');
      const fill = c.primary, ink = k.on(fill);
      const tw = Math.min(W * 0.86, u(760)), th = Math.min(H * 0.62, tw * 0.95), tx = (W - tw) / 2, ty = (H - th) / 2 + u(40);
      const notch = u(46), cut = th * 0.66;
      const mask = `radial-gradient(circle at 0 ${r2(cut)}px, transparent ${notch}px, #000 ${notch + 1}px) left / 51% 100% no-repeat, radial-gradient(circle at 100% ${r2(cut)}px, transparent ${notch}px, #000 ${notch + 1}px) right / 51% 100% no-repeat`;
      const pad = u(64);
      k.node('div', 'ticket', abs(r2(tx), r2(ty), r2(tw), r2(th), {background: fill, borderRadius: u(36), WebkitMask: mask, mask, transformOrigin: '50% 50%'}), [
        el('div', null, abs(pad, r2(cut), r2(tw - pad * 2), 0, {borderTop: `${u(6)}px dashed ${ink}`, opacity: 0.4}))
      ], undefined, {kind: 'scale', beat: 0});
      k.text('label', 'COMMENT', {x: tx + pad, y: ty + pad, width: tw - pad * 2, family: 'meta', preferred: 36, maxLines: 1, color: ink, spacing: 0.25, meta: true, style: {opacity: 0.8}}, {kind: 'fade', beat: 1});
      k.text('keyword', f.keyword, {x: tx + pad, y: ty + pad + u(56), width: tw - pad * 2, preferred: 240, maxLines: 1, lineHeight: 1, color: ink}, {kind: 'rise', beat: 1});
      k.text('offer', `and get ${f.offer}`, {x: tx + pad, y: ty + cut + u(48), width: tw - pad * 2, family: 'body', preferred: 50, maxLines: 2, lineHeight: 1.2, color: ink}, {kind: 'rise', beat: 2});
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: Math.max(0, ty - u(200)), h: u(130), align: 'center', ground}, {kind: 'fade', beat: 0});
      k.event('ask', k.beat(1), 'emphasis', 'pop');
      return ground;
    }
  },
  {
    id: 'keyword-stamp', family: 'type-led', grounds: ['footage', 'paper'], actions: ['keyword'], tags: ['playful', 'editorial'], needs: ['keyword', 'offer'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full} = k;
      const ground = k.ground('footage');
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: '#00000059'}));
      const ink = bigInk(k, c.primary, '#151515');
      const sw = W * 0.8, sx = (W - sw) / 2, sy = H * 0.3;
      const inner = sw - u(80);
      const kw = k.measure(f.keyword, {width: inner, preferred: 220, maxLines: 1, lineHeight: 1});
      const sh = u(40) + u(44) + u(16) + kw.height + u(44);
      k.node('div', 'stamp', abs(r2(sx), r2(sy), r2(sw), r2(sh), {boxSizing: 'border-box', border: `${u(16)}px double ${ink}`, borderRadius: u(22), background: '#00000059', color: ink, textAlign: 'center', transformOrigin: '50% 50%'}), [
        el('div', null, {marginTop: u(36), fontFamily: k.fonts.meta, fontSize: Math.max(k.u(36), 1), letterSpacing: '0.3em', lineHeight: 1.2}, ['COMMENT']),
        el('div', null, {marginTop: u(12), fontFamily: k.fonts.display, fontSize: kw.size, lineHeight: 1}, [f.keyword])
      ], undefined, {kind: 'stamp', beat: 1, rotation: -8});
      k.keyText(kw.size);
      k.text('offer', `for ${f.offer}`, {x: 0, y: sy + sh + u(110), width: W, family: 'body', preferred: 54, maxLines: 2, lineHeight: 1.2, color: '#ffffff', align: 'center', weight: 600}, {kind: 'rise', beat: 3});
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: 0, h: u(120), align: 'center', ground}, {kind: 'fade', beat: 0});
      k.event('ask', k.beat(1), 'emphasis', 'thud');
      return ground;
    }
  },
  {
    id: 'last-line', family: 'type-led', grounds: ['footage'], actions: ['save', 'follow', 'loop'], tags: ['editorial', 'calm'], needs: ['headline'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('footage');
      k.scrim('to top', 0.78, 0.7);
      const opts = {width: W, preferred: 150, maxLines: 4, lineHeight: 1.02};
      const head = k.measure(f.headline, opts);
      const bottom = H - u(150);
      k.text('headline', f.headline, {...opts, x: 0, y: bottom - u(70) - head.height, color: '#ffffff', italic: true}, {kind: 'rise', beat: 0});
      k.node('div', 'bar', abs(0, r2(bottom - u(40)), r2(W * 0.45), u(14), {background: c.primary}), [], undefined, {kind: 'wipe', beat: 1});
      const ask = f.handle ?? f.url;
      if (ask) k.text('ask', ask, {x: 0, y: bottom + u(10), width: W, family: 'meta', preferred: 44, maxLines: 1, color: '#ffffff', meta: true}, {kind: 'rise', beat: 2});
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: 0, h: u(120), align: 'center', ground}, {kind: 'fade', beat: 2});
      return ground;
    }
  },
  {
    id: 'stacked-index', family: 'type-led', grounds: ['paper', 'card'], actions: ['subscribe', 'follow'], tags: ['editorial', 'calm', 'technical'], needs: ['next'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('paper');
      const ink = k.on(ground, c.ink), num = bigInk(k, c.primary, ground);
      if (k.hasLogo) k.logo('logo', {x: 0, y: 0, h: u(130), ground}, {kind: 'rise', beat: 0});
      const col = u(120), y1 = H * 0.3;
      const was = f.hook ?? f.headline ?? 'This one';
      k.text('n1', '01', {x: 0, y: y1, width: col, family: 'meta', preferred: 44, maxLines: 1, color: ink, meta: true, style: {opacity: 0.45}}, {kind: 'fade', beat: 1});
      const one = k.text('was', was, {x: col, y: y1, width: W - col, family: 'body', preferred: 48, maxLines: 2, lineHeight: 1.25, color: ink, meta: true, style: {opacity: 0.45, textDecoration: 'line-through'}}, {kind: 'fade', beat: 1});
      const yRule = y1 + one.height + u(44);
      k.node('div', 'rule', abs(0, r2(yRule), W, u(2), {background: ink, opacity: 0.25}), [], undefined, {kind: 'wipe', beat: 2});
      const y2 = yRule + u(48);
      k.text('n2', '02', {x: 0, y: y2 + u(14), width: col, family: 'meta', preferred: 44, maxLines: 1, color: num, meta: true}, {kind: 'rise', beat: 2});
      k.text('next', f.next, {x: col, y: y2, width: W - col, preferred: 140, maxLines: 4, lineHeight: 1.04, color: ink}, {kind: 'rise', beat: 3});
      k.text('ask', `SUBSCRIBE${f.handle ? ` · ${f.handle.toUpperCase()}` : ' · NEXT ONE SOON'}`, {x: 0, y: H - u(60), width: W, family: 'meta', preferred: 36, maxLines: 1, color: ink, spacing: 0.18, meta: true}, {kind: 'rise', beat: 4});
      return ground;
    }
  }
];
