// End-card layouts, graphic family: a designed object (docs/END_CARDS_RFC.md
// §5.4). See end-card-layouts-type.mjs for the layout shape.

import {el, abs} from './catalog-b-view.mjs';
import {bigInk, stack} from './end-card-layouts-type.mjs';

const r2 = v => Math.round(v * 100) / 100;

export const GRAPHIC_LAYOUTS = [
  {
    id: 'poster', family: 'graphic', grounds: ['card'], actions: ['launch', 'visit'], tags: ['loud', 'editorial'], needs: ['date', 'place'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('card', c.primary);
      const ink = k.on(ground);
      const meta = {family: 'meta', preferred: 38, maxLines: 1, color: ink, spacing: 0.18, meta: true};
      k.text('top-l', (f.handle ?? f.url ?? 'Live').toUpperCase(), {...meta, x: 0, y: 0, width: W * 0.6}, {kind: 'fade', beat: 0});
      k.text('top-r', 'SAVE THE DATE', {...meta, x: W * 0.5, y: 0, width: W * 0.5, align: 'right'}, {kind: 'fade', beat: 0});
      // Built from the bottom up, so the date takes whatever height is left.
      const logoH = k.hasLogo ? u(130) : 0, rowH = u(56);
      if (logoH) k.logo('logo', {x: 0, y: H - logoH, h: logoH, ground, maxWidth: W * 0.5}, {kind: 'fade', beat: 4});
      const yRow = H - logoH - (logoH ? u(64) : 0) - rowH, yThin = yRow - u(32);
      const row = {family: 'meta', preferred: 44, maxLines: 1, color: ink, meta: true, weight: 700};
      if (f.slot) k.text('slot', f.slot, {...row, x: 0, y: yRow, width: W * 0.55}, {kind: 'rise', beat: 3});
      if (f.url) k.text('ask', f.url, {...row, x: W * 0.4, y: yRow, width: W * 0.6, align: 'right'}, {kind: 'rise', beat: 4});
      k.node('div', 'thin', abs(0, r2(yThin), W, u(3), {background: ink}), [], undefined, {kind: 'wipe', beat: 3});
      const placeOpts = {width: W, preferred: 110, maxLines: 2, lineHeight: 1.02};
      const placeH = k.measure(f.place, placeOpts).height, yPlace = yThin - u(40) - placeH, yRule = yPlace - u(44) - u(14);
      k.text('place', f.place, {...placeOpts, x: 0, y: yPlace, color: ink}, {kind: 'rise', beat: 2});
      k.node('div', 'rule', abs(0, r2(yRule), W, u(14), {background: ink}), [], undefined, {kind: 'wipe', beat: 2});
      const dateOpts = {width: W, preferred: 280, maxLines: 2, lineHeight: 0.86, upper: true, spacing: -0.02};
      // Anchored by its bottom edge, so a face wider than the estimate wraps upward, never onto the rule.
      k.text('date', f.date, {...dateOpts, x: 0, y: 0, color: ink, style: {top: 'auto', bottom: r2(H - yRule + u(50))}}, {kind: 'rise', beat: 1});
      return ground;
    }
  },
  {
    id: 'receipt', family: 'graphic', grounds: ['paper', 'card'], actions: ['keyword', 'book'], tags: ['playful', 'technical'], needs: ['keyword', 'offer'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('card');
      const paper = c.paper, ink = k.on(paper, c.ink);
      const sw = W, sx = 0, pad = u(64), inner = sw - pad * 2;
      const zig = u(22), tile = u(48);
      const mask = `linear-gradient(#000, #000) top / 100% calc(100% - ${zig}px) no-repeat, radial-gradient(circle at 50% 100%, transparent ${r2(zig * 0.8)}px, #000 ${r2(zig * 0.8 + 1)}px) bottom / ${tile}px ${zig}px repeat-x`;
      const line = {family: 'meta', preferred: 48, maxLines: 1, color: ink, meta: true};
      const logoH = k.hasLogo ? u(150) : 0, rowH = u(76);
      const kw = k.measure(f.keyword, {width: inner * 0.6, preferred: 220, maxLines: 1, lineHeight: 1});
      const sh = pad + (logoH ? logoH + u(48) : 0) + rowH * 3 + u(40) + kw.height + u(56) + rowH + pad + zig;
      const sy = Math.max(0, (H - sh) / 2);
      k.node('div', 'strip', abs(r2(sx), r2(sy), r2(sw), r2(sh), {background: paper, WebkitMask: mask, mask, boxShadow: `0 ${u(30)}px ${u(80)}px #00000059`}), [], undefined, {kind: 'rise', beat: 0});
      let y = sy + pad;
      if (logoH) { k.logo('logo', {x: W / 2, y, h: logoH, align: 'center', ground: paper, maxWidth: inner}, {kind: 'fade', beat: 0}); y += logoH + u(48); }
      [[f.offer, 'FREE'], ['this video', '0.00'], ['a follow', '0.00']].forEach(([left, right], i) => {
        k.text(`l${i}`, left, {...line, x: sx + pad, y, width: inner * 0.72}, {kind: 'fade', beat: 1 + i * 0.5});
        k.text(`r${i}`, right, {...line, x: sx + pad + inner * 0.7, y, width: inner * 0.3, align: 'right'}, {kind: 'fade', beat: 1 + i * 0.5});
        y += rowH;
      });
      k.node('div', 'dash', abs(r2(sx + pad), r2(y + u(12)), r2(inner), 0, {borderTop: `${u(4)}px dashed ${ink}`}), [], undefined, {kind: 'wipe', beat: 2.5});
      y += u(40);
      k.text('total', 'COMMENT', {...line, x: sx + pad, y: y + kw.height - u(64), width: inner * 0.4, weight: 700}, {kind: 'fade', beat: 3});
      k.text('keyword', f.keyword, {x: sx + pad + inner * 0.4, y, width: inner * 0.6, preferred: 220, maxLines: 1, lineHeight: 1, color: bigInk(k, c.primary, paper), align: 'right'}, {kind: 'rise', beat: 3});
      y += kw.height + u(56);
      k.text('thanks', `${f.url ?? f.handle ?? ''} · THANK YOU`.replace(/^ · /, ''), {...line, x: sx + pad, y, width: inner, align: 'center', preferred: 40, style: {opacity: 0.65}}, {kind: 'fade', beat: 4});
      k.event('ask', k.beat(3), 'emphasis', 'pop');
      return ground;
    }
  },
  {
    id: 'typed-page', family: 'graphic', grounds: ['paper'], actions: ['keyword', 'subscribe'], tags: ['editorial', 'technical', 'calm'], needs: ['headline', 'url'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full} = k;
      const ground = k.ground('paper');
      const ink = k.on(ground, c.ink), inset = u(44);
      k.node('div', 'frame', abs(r2(full.x + inset), r2(full.y + inset), r2(full.width - inset * 2), r2(full.height - inset * 2), {boxSizing: 'border-box', border: `${Math.max(1, u(3))}px solid ${ink}`}), [], undefined, {kind: 'fade', beat: 0});
      k.text('issue', f.issue ?? 'No. 01', {x: 0, y: u(20), width: W * 0.5, family: 'meta', preferred: 44, maxLines: 1, color: ink, meta: true}, {kind: 'fade', beat: 0});
      // A see-through mark is inked in the primary colour, like a rubber stamp; a boxed one keeps its plate.
      const stampInk = k.logoClass.endsWith('-clear') ? {mode: 'color', color: k.on(ground, c.primary)} : undefined;
      if (k.hasLogo) k.logo('logo', {x: W, y: 0, h: u(190), align: 'right', ground, force: stampInk, maxWidth: W * 0.5}, {kind: 'stamp', beat: 1, rotation: -12});
      const head = k.text('headline', f.headline, {x: 0, y: H * 0.3, width: W, family: 'meta', preferred: 104, maxLines: 5, lineHeight: 1.3, color: ink, weight: 700}, {kind: 'rise', beat: 2});
      const typed = `> ${f.url}`, y = Math.min(H - u(90), Math.max(H * 0.72, H * 0.3 + head.height + u(120)));
      const t = k.text('ask', typed, {x: 0, y, width: W * 0.9, family: 'meta', preferred: 64, maxLines: 1, color: ink}, {kind: 'type', beat: 3, text: typed});
      k.node('div', 'cursor', abs(r2(Math.min(W - u(30), t.width + u(10))), r2(y + t.size * 0.12), r2(t.size * 0.55), r2(t.size * 0.95), {background: ink}), [], undefined, {kind: 'blink', beat: 3});
      return ground;
    }
  },
  {
    id: 'badge-row', family: 'graphic', grounds: ['card'], actions: ['download'], tags: ['technical', 'playful'], needs: ['app', 'badges'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('card');
      const ink = k.on(ground);
      const tile = u(400), badgeH = u(150), gap = u(30);
      const name = k.measure(f.app, {width: W, preferred: 160, maxLines: 2, lineHeight: 1.04});
      const [yTile, yName, yStars, yBadges] = stack([tile, name.height, u(70), badgeH], u(56), 0, H);
      k.node('div', 'tile', abs(r2((W - tile) / 2), yTile, tile, tile, {background: c.primary, borderRadius: r2(tile * 0.22), boxShadow: `0 ${u(30)}px ${u(80)}px #00000066`, transformOrigin: '50% 50%'}), [], undefined, {kind: 'scale', beat: 0});
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: r2(yTile + tile * 0.3), h: r2(tile * 0.4), align: 'center', ground: c.primary, maxWidth: tile * 0.78}, {kind: 'scale', beat: 0});
      k.text('app', f.app, {x: 0, y: yName, width: W, preferred: 160, maxLines: 2, lineHeight: 1.04, color: ink, align: 'center'}, {kind: 'rise', beat: 1});
      k.text('stars', `★★★★★${f.rating ? `  ${f.rating}` : ''}`, {x: 0, y: yStars, width: W, family: 'body', preferred: 54, maxLines: 1, color: bigInk(k, c.accent, ground), align: 'center', spacing: 0.12, meta: true}, {kind: 'fade', beat: 2});
      const widths = k.badges.map(badge => badgeH * badge.ratio);
      const total = widths.reduce((s, w) => s + w, 0) + gap * (widths.length - 1), scale = Math.min(1, W / total);
      let x = (W - total * scale) / 2;
      k.badges.forEach((badge, i) => {
        k.node('img', `badge-${i}`, abs(r2(x), yBadges, r2(widths[i] * scale), r2(badgeH * scale), {objectFit: 'contain'}), [], {src: badge.src, alt: ''}, {kind: 'rise', beat: 3 + i * 0.5});
        x += (widths[i] + gap) * scale;
      });
      return ground;
    }
  },
  {
    id: 'countdown', family: 'graphic', grounds: ['card', 'footage'], actions: ['launch'], tags: ['loud', 'technical'], needs: ['date'],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('card');
      const ink = k.on(ground), num = bigInk(k, c.primary, ground);
      const gap = u(28), tw = (W - gap * 2) / 3, th = u(330);
      const live = k.measure(`Live ${f.date}`, {width: W, preferred: 130, maxLines: 2, lineHeight: 1.04});
      const [yLogo, yTiles, yLive, yUrl] = stack([k.hasLogo ? u(130) : 0, th, live.height, f.url ? u(50) : 0], u(64), 0, H);
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: yLogo, h: u(130), align: 'center', ground}, {kind: 'fade', beat: 0});
      [['3', 'DAYS'], ['14', 'HRS'], ['22', 'MIN']].forEach(([value, label], i) => {
        const x = i * (tw + gap);
        k.node('div', `tile-${i}`, abs(r2(x), yTiles, r2(tw), th, {background: `${c.paper}14`, border: `${u(3)}px solid ${c.paper}33`, borderRadius: u(28), boxSizing: 'border-box'}), [], undefined, {kind: 'rise', beat: 1 + i * 0.3});
        k.text(`n${i}`, value, {x, y: yTiles + u(50), width: tw, preferred: 200, maxLines: 1, lineHeight: 1, color: num, align: 'center', style: {fontVariantNumeric: 'tabular-nums'}}, {kind: 'rise', beat: 1 + i * 0.3});
        const n = Number(value), values = Array.from({length: 8}, (_, j) => String(n + 7 - j)); // unpadded: GSAP text gets a word joiner before a zero-padded number
        k.motion(`n${i}`, {kind: 'count', beat: 1 + i * 0.3, values, step: 0.09});
        k.text(`l${i}`, label, {x, y: yTiles + th - u(84), width: tw, family: 'meta', preferred: 36, maxLines: 1, color: ink, align: 'center', spacing: 0.18, meta: true, style: {opacity: 0.7}}, {kind: 'fade', beat: 1 + i * 0.3});
      });
      k.text('live', `Live ${f.date}`, {x: 0, y: yLive, width: W, preferred: 130, maxLines: 2, lineHeight: 1.04, color: ink, align: 'center'}, {kind: 'rise', beat: 2.5});
      if (f.url) k.text('ask', f.url, {x: 0, y: yUrl, width: W, family: 'meta', preferred: 46, maxLines: 1, color: ink, align: 'center', meta: true}, {kind: 'rise', beat: 3.5});
      return ground;
    }
  },
  {
    id: 'diagonal-band', family: 'graphic', grounds: ['card'], actions: ['url', 'follow'], tags: ['loud', 'playful'], needs: ['url'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full} = k;
      const ground = k.ground('card');
      const ink = k.on(ground), bandInk = k.on(c.primary);
      const bandH = u(280), yc = H * 0.54;
      k.node('div', 'band', abs(r2(full.x - full.width * 0.25), r2(yc - bandH / 2), r2(full.width * 1.5), bandH, {background: c.primary, transformOrigin: '50% 50%'}), [], undefined, {kind: 'scale', beat: 1, rotation: -12});
      const ask = f.url ?? f.handle;
      const fit = k.measure(ask, {width: W * 0.96, preferred: 170, maxLines: 1, lineHeight: 1});
      k.text('ask', ask, {x: W * 0.02, y: r2(yc - fit.height / 2), width: W * 0.96, preferred: 170, maxLines: 1, lineHeight: 1, color: bandInk, align: 'center'}, {kind: 'rise', beat: 2, rotation: -12, dy: 0});
      const head = f.headline ?? f.reason;
      if (head) k.text('headline', head, {x: 0, y: 0, width: W, preferred: 130, maxLines: 4, lineHeight: 1.02, color: ink, italic: true}, {kind: 'rise', beat: 0});
      if (k.hasLogo) k.logo('logo', {x: 0, y: H - u(130), h: u(130), ground}, {kind: 'fade', beat: 3});
      return ground;
    }
  },
  {
    id: 'marquee', family: 'graphic', grounds: ['card', 'footage'], actions: ['follow', 'url'], tags: ['loud', 'playful'], needs: ['handle', 'url'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full, canvas} = k;
      const ground = k.ground('card');
      const ink = k.on(ground), bandH = u(220);
      const band = (key, value, y, fill, color, reverse, beat) => {
        const shown = `${value.toUpperCase()} ·`;
        const fit = k.measure(shown, {width: W, preferred: 150, maxLines: 1, lineHeight: 1});
        k.keyText(fit.size);
        // Each repeat is a fixed-width box, so one cycle moves exactly one repeat and the loop is seamless.
        const unit = r2(fit.width + u(60)), count = Math.ceil((canvas.width * 2) / unit) + 1;
        const spans = Array.from({length: count}, () => el('span', null, {display: 'inline-block', width: unit, whiteSpace: 'nowrap'}, [shown]));
        k.node('div', `${key}-band`, abs(full.x, r2(y), full.width, bandH, {overflow: 'hidden', background: fill ?? 'transparent', boxSizing: 'border-box', ...(fill ? {} : {borderTop: `${u(4)}px solid ${ink}55`, borderBottom: `${u(4)}px solid ${ink}55`})}), [
          el('div', `${k.id}-${key}`, abs(0, r2((bandH - fit.size) / 2), r2(unit * count), fit.size, {display: 'flex', fontFamily: k.fonts.display, fontSize: fit.size, lineHeight: 1, color}), spans)
        ], undefined, {kind: 'fade', beat});
        k.motion(key, {kind: 'ticker', distance: unit, reverse, cycle: 7});
      };
      band('row1', f.handle, H * 0.08, c.primary, k.on(c.primary), false, 0);
      band('row2', f.url, H * 0.92 - bandH, null, ink, true, 1);
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: r2(H * 0.5 - u(100)), h: u(200), align: 'center', ground, maxWidth: W * 0.8}, {kind: 'scale', beat: 2});
      k.event('ask', k.beat(1), 'emphasis', 'whoosh');
      return ground;
    }
  }
];
