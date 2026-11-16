// End-card layouts, brand-led family: the logo is the design
// (docs/END_CARDS_RFC.md §5.2). Shape and kit: see end-card-layouts-type.mjs.

import {el, abs} from './catalog-b-view.mjs';
import {stack} from './end-card-layouts-type.mjs';

const r2 = v => Math.round(v * 100) / 100;

/** An underlined single-line address at (x, y): the rule is as long as the text. */
function underlined(k, key, value, {x, y, align = 'left', color, rule, preferred = 50}, motion) {
  const {u, W} = k;
  const m = k.measure(value, {width: W, family: 'meta', preferred, maxLines: 1});
  const width = Math.min(W, m.width + u(8));
  const left = align === 'center' ? (W - width) / 2 : x;
  k.text(key, value, {x: left, y, width, family: 'meta', preferred, maxLines: 1, lineHeight: 1.2, color, align, weight: 700,
    style: {borderBottom: `${u(7)}px solid ${rule}`, paddingBottom: u(10)}}, motion);
  return m.size * 1.2 + u(17);
}

export const BRAND_LAYOUTS = [
  {
    id: 'bloom', family: 'brand-led', grounds: ['card'], actions: ['url', 'download'], tags: ['premium', 'calm'], needs: ['logo', 'url'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('card');
      const logoH = u(160);
      const head = f.headline ? {width: W, preferred: 130, maxLines: 3, lineHeight: 1.04} : null;
      const fit = head ? k.measure(f.headline, head) : null;
      const pill = k.measure(f.url, {width: W * 0.8, family: 'meta', preferred: 54, maxLines: 1});
      const pillH = r2(pill.size * 1.2 + u(56));
      // A boxed logo's plate adds 28% padding on each side: reserve it either way.
      const blocks = [logoH * 1.56, ...(fit ? [fit.height] : []), pillH];
      const [yLogo, yHead, yPillMaybe] = stack(blocks, u(64), 0, H);
      const yPill = fit ? yPillMaybe : yHead;
      // The bloom: a soft brand light behind the lockup, centred on the logo.
      const size = r2(Math.max(W, H) * 1.1), cy = yLogo + logoH * 0.78;
      k.node('div', 'bloom', abs(r2(W / 2 - size / 2), r2(cy - size / 2), size, size, {borderRadius: '50%', transformOrigin: '50% 50%',
        background: `radial-gradient(closest-side, ${c.primary}a6, ${c.primary}38 46%, ${c.primary}00 74%)`}), [], undefined, {kind: 'scale', beat: 0});
      k.logo('logo', {x: W / 2, y: yLogo, h: logoH, align: 'center', ground, maxWidth: W * 0.8}, {kind: 'rise', beat: 0});
      if (fit) k.text('headline', f.headline, {...head, x: 0, y: yHead, color: k.on(ground), align: 'center', italic: true}, {kind: 'rise', beat: 1});
      const pw = r2(Math.min(W, pill.width + u(110)));
      k.node('div', 'pill', abs(r2((W - pw) / 2), yPill, pw, pillH, {boxSizing: 'border-box', borderRadius: pillH / 2, background: c.primary, color: k.on(c.primary),
        fontFamily: k.fonts.meta, fontWeight: 700, fontSize: pill.size, lineHeight: `${pillH}px`, textAlign: 'center', whiteSpace: 'nowrap', transformOrigin: '50% 50%',
        boxShadow: `0 ${u(18)}px ${u(50)}px #00000066`}), [f.url], undefined, {kind: 'scale', beat: 2});
      k.keyText(pill.size);
      return ground;
    }
  },
  {
    id: 'split-panel', family: 'brand-led', grounds: ['split'], actions: ['url', 'follow', 'save', 'visit', 'book'], tags: ['editorial', 'premium'], needs: ['logo', 'headline'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full} = k;
      const ground = k.ground('paper');
      const blockH = r2(full.height * 0.46), blockBottom = r2(full.y + blockH);
      k.node('div', 'block', abs(full.x, full.y, full.width, blockH, {background: c.primary, transformOrigin: '50% 0%'}), [], undefined, {kind: 'wipe', beat: 0});
      // The logo sits in the block in its native contrast (a boxed one keeps its plate).
      const logoH = u(170), cy = full.y + blockH / 2;
      // A see-through mark is knocked out in the block's own readable ink; a boxed one keeps its plate.
      const knock = k.logoClass.endsWith('-clear') ? {mode: 'color', color: k.on(c.primary)} : undefined;
      k.logo('logo', {x: W / 2, y: r2(Math.max(0, cy - logoH / 2)), h: logoH, align: 'center', ground: c.primary, force: knock, maxWidth: W * 0.8}, {kind: 'rise', beat: 1});
      const ink = k.on(ground, c.ink);
      const ask = f.url ?? f.handle;
      const askH = ask ? k.measure(ask, {width: W, family: 'meta', preferred: 50, maxLines: 1}).size * 1.2 + u(17) : 0;
      const top = Math.max(0, blockBottom) + u(70), room = H - askH - u(50) - top;
      // The largest headline that fits between the block and the address.
      const preferred = [140, 124, 110, 96, 84, 72].find(size => k.measure(f.headline, {width: W, preferred: size, maxLines: 4, lineHeight: 1.04}).height <= room) ?? 64;
      const head = k.text('headline', f.headline, {x: 0, y: top, width: W, preferred, maxLines: 4, lineHeight: 1.04, color: ink, italic: true}, {kind: 'rise', beat: 2});
      if (ask) underlined(k, 'ask', ask, {x: 0, y: r2(top + head.height + u(60)), color: ink, rule: c.primary}, {kind: 'rise', beat: 3});
      return c.primary;
    }
  },
  {
    id: 'plate-centre', family: 'brand-led', grounds: ['card', 'footage'], actions: ['url', 'visit'], tags: ['calm', 'premium'], needs: ['logo', 'url'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.blurGround();
      const ink = ground === 'footage' ? '#ffffff' : k.on(ground);
      const logoH = u(200);
      const place = f.place ? k.measure(f.place, {width: W * 0.9, family: 'body', preferred: 72, maxLines: 2, lineHeight: 1.25}) : null;
      const urlH = k.measure(f.url, {width: W, family: 'meta', preferred: 60, maxLines: 1}).size * 1.2 + u(17);
      const plate = logoH * 1.56;
      const blocks = [plate, ...(place ? [place.height] : []), urlH];
      const tops = stack(blocks, u(70), 0, H);
      k.logo('logo', {x: W / 2, y: tops[0], h: logoH, align: 'center', ground, force: {mode: 'plate'}, maxWidth: W * 0.7}, {kind: 'scale', beat: 0});
      if (place) k.text('place', f.place, {x: W * 0.05, y: tops[1], width: W * 0.9, family: 'body', preferred: 72, maxLines: 2, lineHeight: 1.25, color: ink, align: 'center', weight: 500}, {kind: 'rise', beat: 1});
      underlined(k, 'url', f.url, {x: 0, y: tops.at(-1), align: 'center', color: ink, rule: c.primary, preferred: 60}, {kind: 'rise', beat: 2});
      return ground;
    }
  },
  {
    id: 'wordmark-wipe', family: 'brand-led', grounds: ['card'], actions: ['launch', 'url'], tags: ['loud', 'technical'], needs: ['logo', 'url'],
    build(k) {
      const {W, H, u, fields: f, colors: c, land} = k;
      const ground = k.ground('card');
      const ink = k.on(ground);
      const logoH = u(190);
      const line = `${f.date ? `LIVE ${f.date.toUpperCase()} · ` : ''}${f.url.toUpperCase()}`;
      const lineFit = k.measure(line, {width: W, family: 'meta', preferred: 44, maxLines: 2, lineHeight: 1.3, spacing: 0.16, meta: true});
      const head = f.headline ? {width: W, preferred: 120, maxLines: 3, lineHeight: 1.04} : null;
      const fit = head ? k.measure(f.headline, head) : null;
      const blocks = [...(fit ? [fit.height] : []), logoH * 1.2, lineFit.height];
      const tops = stack(blocks, u(80), 0, H);
      const [yHead, yLogo, yLine] = fit ? tops : [null, ...tops];
      if (fit) k.text('headline', f.headline, {...head, x: 0, y: yHead, color: ink, align: 'center', italic: true}, {kind: 'rise', beat: 2});
      // The bar wipes across, the wordmark is left behind it.
      const box = k.logo('logo', {x: W / 2, y: yLogo + logoH * 0.1, h: logoH, align: 'center', ground, maxWidth: W * 0.9}, {kind: 'fade', beat: 0, offset: land * 0.45});
      const pad = u(24);
      k.node('div', 'bar', abs(r2(box.x - pad), r2(yLogo + logoH * 0.1 - pad), r2(box.width + pad * 2), r2(box.height + pad * 2), {background: c.accent}), [], undefined, {kind: 'bar', beat: 0});
      k.text('ask', line, {x: 0, y: yLine, width: W, family: 'meta', preferred: 44, maxLines: 2, lineHeight: 1.3, color: ink, align: 'center', spacing: 0.16, meta: true, weight: 600}, {kind: 'rise', beat: 3});
      return ground;
    }
  },
  {
    id: 'mark-orbit', family: 'brand-led', grounds: ['card'], actions: ['follow', 'subscribe'], tags: ['playful', 'premium'], needs: ['logo', 'handle'],
    build(k) {
      const {W, H, u, fields: f, colors: c, id} = k;
      const ground = k.ground('card');
      const ink = k.on(ground);
      const d = r2(Math.min(W, H) * 0.92), cx = W / 2, cy = Math.min(H * 0.42, H - d / 2 - u(200));
      const ring = `${f.handle} · ${f.reason ?? 'follow along'} · `.toUpperCase();
      const r = 42, circ = 2 * Math.PI * r;
      // The ring of type: repeated to go once round, sized to fill the circumference.
      const reps = Math.max(1, Math.round(circ / (ring.length * 0.62 * 5)));
      const fontSize = r2(circ / (ring.length * reps * 0.66));
      const pathId = `${id}-orbit-path`;
      k.node('div', 'orbit', abs(r2(cx - d / 2), r2(cy - d / 2), d, d, {transformOrigin: '50% 50%'}), [
        el('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, [
          el('defs', null, null, [el('path', pathId, null, [], {d: `M50 50m-${r} 0a${r} ${r} 0 1 1 ${r * 2} 0a${r} ${r} 0 1 1 -${r * 2} 0`})]),
          el('text', null, {fontFamily: k.fonts.meta, fontSize, fontWeight: 700, letterSpacing: `${r2(fontSize * 0.08)}`}, [
            el('textPath', null, null, [ring.repeat(reps)], {href: `#${pathId}`})
          ], {fill: k.on(ground, c.primary)})
        ], {width: d, height: d, viewBox: '0 0 100 100'})
      ], undefined, {kind: 'spin', degrees: 40});
      k.logo('logo', {x: cx, y: r2(cy - u(85)), h: u(170), align: 'center', ground, maxWidth: d * 0.6}, {kind: 'scale', beat: 0});
      k.text('ask', `Follow ${f.handle}`, {x: 0, y: r2(H - u(170)), width: W, family: 'body', preferred: 64, maxLines: 1, color: ink, align: 'center', weight: 600}, {kind: 'rise', beat: 2});
      return ground;
    }
  },
  {
    id: 'monogram', family: 'brand-led', grounds: ['paper'], actions: ['url', 'follow', 'save'], tags: ['editorial', 'premium', 'loud'], needs: ['headline'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full} = k;
      const ground = k.ground('paper');
      const ink = k.on(ground, c.ink);
      const letter = (f.app ?? f.url ?? f.handle ?? f.headline).replace(/^@/, '')[0].toUpperCase();
      // The initial, huge and cropped by the frame's bottom-right corner.
      const size = r2(Math.max(full.width, full.height) * 0.7);
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {overflow: 'hidden'}), [
        el('div', `${k.id}-letter`, abs(r2(full.width - size * 0.55), r2(full.height - size * 0.82), undefined, undefined, {fontFamily: k.fonts.display, fontSize: size, lineHeight: 1, color: c.primary, whiteSpace: 'nowrap', transformOrigin: '50% 50%'}), [letter])
      ]);
      k.motion('letter', {kind: 'rise', beat: 0, dy: u(60)});
      if (k.hasLogo) k.logo('logo', {x: 0, y: 0, h: u(140), ground, maxWidth: W * 0.6}, {kind: 'rise', beat: 1});
      const head = k.text('headline', f.headline, {x: 0, y: H * 0.2, width: W * 0.66, preferred: 140, maxLines: 5, lineHeight: 1.02, color: ink, italic: true}, {kind: 'rise', beat: 2});
      const ask = f.url ?? f.handle;
      if (ask) k.text('ask', `${ask} →`, {x: 0, y: r2(H * 0.2 + head.height + u(60)), width: W * 0.66, family: 'meta', preferred: 48, maxLines: 1, color: ink, weight: 700}, {kind: 'rise', beat: 3});
      return ground;
    }
  }
];
