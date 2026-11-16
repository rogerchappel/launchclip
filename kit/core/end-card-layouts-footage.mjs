// End-card layouts, footage-led family: the ending stays in the video
// (docs/END_CARDS_RFC.md §5.3). See end-card-layouts-type.mjs for the layout
// shape. Over footage the ground is 'footage' (dark): params.still is held and
// pushes in, or, without it, the shot keeps playing under the ending.

import {el, abs} from './catalog-b-view.mjs';
import {bigInk, stack} from './end-card-layouts-type.mjs';

const r2 = v => Math.round(v * 100) / 100;
const WHITE = '#ffffff';

export const FOOTAGE_LAYOUTS = [
  {
    id: 'freeze-scrim', family: 'footage-led', grounds: ['footage'], actions: ['any'], tags: ['editorial', 'calm', 'premium'], needs: ['headline'],
    build(k) {
      const {W, H, u, fields: f} = k;
      const ground = k.ground('footage');
      k.scrim('to top', 0.9, 0.72);
      if (k.hasLogo) k.logo('logo', {x: W, y: 0, h: u(120), align: 'right', ground}, {kind: 'fade', beat: 0});
      const ask = f.url ?? f.handle;
      const opts = {width: W, preferred: 150, maxLines: 4, lineHeight: 1.02};
      const head = k.measure(f.headline, opts);
      const yRule = H - u(110);
      k.text('headline', f.headline, {...opts, x: 0, y: yRule - u(60) - head.height, color: WHITE, italic: true}, {kind: 'rise', beat: 1});
      k.node('div', 'rule', abs(0, yRule, W, u(3), {background: '#ffffff66'}), [], undefined, {kind: 'wipe', beat: 2});
      if (ask) {
        k.text('ask', ask, {x: 0, y: yRule + u(36), width: W - u(80), family: 'meta', preferred: 46, maxLines: 1, color: WHITE, meta: true}, {kind: 'rise', beat: 3});
        k.text('arrow', '→', {x: W - u(70), y: yRule + u(30), width: u(70), family: 'body', preferred: 52, maxLines: 1, color: WHITE, align: 'right', meta: true}, {kind: 'rise', beat: 3, dx: -u(30), dy: 0});
      }
      return ground;
    }
  },
  {
    id: 'live-lower', family: 'footage-led', grounds: ['footage'], actions: ['url', 'follow', 'keyword'], tags: ['calm', 'editorial'], needs: [], needsAny: [['keyword', 'handle', 'url'], ['offer', 'reason', 'headline']],
    build(k) {
      const {W, H, u, fields: f, colors: c} = k;
      const ground = k.ground('footage');
      k.scrim('to right', 0.85, 0.8);
      const label = f.keyword ? `COMMENT ${f.keyword}` : (f.handle ?? f.url).toUpperCase();
      const line = f.keyword && f.offer ? `for ${f.offer}` : f.reason ? `Follow for ${f.reason}` : f.offer ?? f.headline;
      const pad = u(56), width = W * 0.86 - pad;
      const lab = k.measure(label, {width, family: 'meta', preferred: 46, maxLines: 1, meta: true});
      const body = k.measure(line, {width, preferred: 130, maxLines: 4, lineHeight: 1.04});
      const block = lab.size * 1.3 + u(26) + body.height;
      const top = H - u(200) - block;
      k.node('div', 'bar', abs(0, r2(top), u(14), r2(block), {background: c.primary}), [], undefined, {kind: 'wipe', beat: 0});
      k.text('label', label, {x: pad, y: top, width, family: 'meta', preferred: 46, maxLines: 1, lineHeight: 1.3, color: bigInk(k, c.primary, '#151515'), spacing: 0.12, meta: true}, {kind: 'rise', beat: 1});
      k.text('line', line, {x: pad, y: top + lab.size * 1.3 + u(26), width, preferred: 130, maxLines: 4, lineHeight: 1.04, color: WHITE}, {kind: 'rise', beat: 2});
      if (k.hasLogo) k.logo('logo', {x: 0, y: H - u(120), h: u(110), ground}, {kind: 'fade', beat: 3});
      k.event('ask', k.beat(1), 'emphasis', 'pop');
      return ground;
    }
  },
  {
    id: 'frame-in-frame', family: 'footage-led', grounds: ['footage', 'card'], actions: ['url', 'book'], tags: ['premium', 'calm'], needs: ['url'],
    build(k) {
      const {W, H, u, fields: f, colors: c, still, id} = k;
      const ground = k.ground('card', c.primary);
      const ink = k.on(ground);
      const wh = r2(H * 0.55), radius = u(36);
      const inner = still
        ? [el('img', `${id}-window-img`, abs(0, 0, W, wh, {objectFit: 'cover', transformOrigin: '50% 50%'}), [], {src: still.src, alt: ''})]
        : [];
      k.node('div', 'window', abs(0, 0, W, wh, {overflow: 'hidden', borderRadius: radius, background: c.bg, transformOrigin: '50% 50%'}), inner, undefined, {kind: 'scale', beat: 0});
      if (still) k.motion('window-img', {kind: 'push'});
      const line = f.slot ?? f.headline ?? f.url;
      k.text('line', line, {x: 0, y: wh + u(60), width: W, preferred: 140, maxLines: 3, lineHeight: 1.02, color: ink, italic: line === f.headline}, {kind: 'rise', beat: 1});
      const yBottom = H - u(110);
      k.text('url', f.url, {x: 0, y: yBottom + u(26), width: W * 0.6, family: 'meta', preferred: 50, maxLines: 1, color: ink, weight: 700}, {kind: 'rise', beat: 2});
      if (k.hasLogo) k.logo('logo', {x: W, y: yBottom, h: u(110), align: 'right', ground, maxWidth: W * 0.36}, {kind: 'fade', beat: 2});
      return 'footage';
    }
  },
  {
    id: 'cutout-type', family: 'footage-led', grounds: ['footage', 'card'], actions: ['save', 'launch'], tags: ['loud', 'playful'], needs: ['headline'],
    build(k) {
      const {W, H, u, fields: f, colors: c, still, full, id, fonts} = k;
      // The short form of the line: the emphasis if set, else the first words that fit.
      const words = (f.emphasis ?? f.headline).replace(/[.!?]+$/, '').split(/\s+/);
      const short = words.slice(0, 4).join(' ').toUpperCase();
      const fit = k.measure(short, {width: W, preferred: 300, maxLines: 4, lineHeight: 0.88});
      k.keyText(fit.size);
      const top = r2((H - fit.height) / 2 - u(80));
      const letters = {position: 'absolute', left: r2(-full.x), top: r2(-full.y + top), width: W, margin: 0, fontFamily: fonts.display, fontSize: fit.size, lineHeight: '0.88', textWrap: 'balance'};
      let ink;
      if (still) {
        k.node('div', null, abs(full.x, full.y, full.width, full.height, {overflow: 'hidden'}), [
          el('img', `${id}-still-img`, abs(0, 0, full.width, full.height, {objectFit: 'cover', transformOrigin: '50% 50%'}), [], {src: still.src, alt: ''})
        ]);
        k.motion('still-img', {kind: 'push'});
        // Lighten keeps the paper outside the letters and shows the shot through the black ones.
        k.node('div', 'cut', abs(full.x, full.y, full.width, full.height, {background: c.paper, mixBlendMode: 'lighten'}), [el('div', null, {...letters, color: '#000000'}, [short])], undefined, {kind: 'fade', beat: 0});
        ink = k.on(c.paper, c.ink);
      } else {
        k.ground('paper');
        k.node('div', 'cut', abs(0, top, W, fit.height, {}), [el('div', null, {...letters, left: 0, top: 0, background: `linear-gradient(135deg, ${c.primary}, ${c.accent})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent'}, [short])], undefined, {kind: 'rise', beat: 0});
        ink = k.on(c.paper, c.ink);
      }
      const ask = f.handle ? `Save this · ${f.handle}` : f.url ? `Save this · ${f.url}` : 'Save this';
      k.text('ask', ask, {x: 0, y: H - u(200), width: W, family: 'body', preferred: 50, maxLines: 1, color: ink, weight: 600}, {kind: 'rise', beat: 2});
      if (k.hasLogo) k.logo('logo', {x: 0, y: H - u(110), h: u(100), ground: c.paper}, {kind: 'fade', beat: 3});
      return c.paper;
    }
  },
  {
    id: 'grade-out', family: 'footage-led', grounds: ['footage'], actions: ['loop', 'follow'], tags: ['calm', 'premium'], needs: ['handle'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full} = k;
      const ground = k.ground('footage');
      k.node('div', 'grade', abs(full.x, full.y, full.width, full.height, {background: c.primary, mixBlendMode: 'multiply'}), [], undefined, {kind: 'fade', beat: 0, to: 1});
      k.node('div', 'lift', abs(full.x, full.y, full.width, full.height, {background: c.bg, mixBlendMode: 'screen'}), [], undefined, {kind: 'fade', beat: 0, to: 0.35});
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: '#00000040'}));
      const line = f.reason ? `Follow for ${f.reason}` : 'Follow along';
      const lineFit = k.measure(line, {width: W, preferred: 130, maxLines: 3, lineHeight: 1.05});
      // The logo goes last (below), so a plated logo's padding never pushes into the words.
      const [yLine, yHandle] = stack([lineFit.height, u(60)], u(50), 0, H * 0.82);
      k.text('line', line, {x: 0, y: yLine, width: W, preferred: 130, maxLines: 3, lineHeight: 1.05, color: WHITE, align: 'center'}, {kind: 'rise', beat: 1});
      k.text('handle', f.handle, {x: 0, y: yHandle, width: W, family: 'meta', preferred: 50, maxLines: 1, color: WHITE, align: 'center', weight: 700}, {kind: 'rise', beat: 2});
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: yHandle + u(160), h: u(130), align: 'center', ground}, {kind: 'rise', beat: 3});
      return ground;
    }
  },
  {
    id: 'pointer', family: 'footage-led', grounds: ['footage'], actions: ['keyword', 'visit'], tags: ['playful', 'technical'], needs: ['keyword', 'offer'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full, id} = k;
      const ground = k.ground('footage');
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: '#00000040'}));
      // The ring sits on the lower left of the shot (the subject), the arrow curves up to the words.
      const ring = {cx: W * 0.3, cy: H * 0.8, rx: W * 0.24, ry: W * 0.12};
      const stroke = bigInk(k, c.primary, '#151515'), sw = u(10);
      const path = (key, d) => el('path', `${id}-${key}`, {strokeDasharray: 100}, [], {d, pathLength: 100, stroke, strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none'});
      // The arrow leaves the words and lands on the top of the ring; its head follows the curve's last tangent.
      const a0 = {x: W * 0.62, y: H * 0.6}, a1 = {x: ring.cx + ring.rx * 0.2, y: ring.cy - ring.ry - u(36)};
      const c1 = {x: W * 0.62, y: H * 0.7}, c2 = {x: a1.x + W * 0.16, y: a1.y - u(40)};
      const ang = Math.atan2(a1.y - c2.y, a1.x - c2.x), len = u(48);
      const h1 = {x: a1.x - len * Math.cos(ang - 0.5), y: a1.y - len * Math.sin(ang - 0.5)}, h2 = {x: a1.x - len * Math.cos(ang + 0.5), y: a1.y - len * Math.sin(ang + 0.5)};
      k.node('svg', null, {position: 'absolute', left: 0, top: 0, overflow: 'visible'}, [
        path('ring', `M ${r2(ring.cx + ring.rx)} ${r2(ring.cy)} A ${r2(ring.rx)} ${r2(ring.ry)} -6 1 1 ${r2(ring.cx + ring.rx - 1)} ${r2(ring.cy - 6 * k.u(1))}`),
        path('arrow', `M ${r2(a0.x)} ${r2(a0.y)} C ${r2(c1.x)} ${r2(c1.y)}, ${r2(c2.x)} ${r2(c2.y)}, ${r2(a1.x)} ${r2(a1.y)}`),
        path('head', `M ${r2(h1.x)} ${r2(h1.y)} L ${r2(a1.x)} ${r2(a1.y)} L ${r2(h2.x)} ${r2(h2.y)}`)
      ], {width: W, height: H, viewBox: `0 0 ${W} ${H}`, fill: 'none'});
      k.motion('ring', {kind: 'draw', beat: 1, duration: 0.8});
      k.motion('arrow', {kind: 'draw', beat: 2, duration: 0.6});
      k.motion('head', {kind: 'draw', beat: 3, duration: 0.25});
      const x = W * 0.34, width = W - x;
      const top = H * 0.2;
      const lab = k.text('label', 'COMMENT', {x, y: top, width, family: 'meta', preferred: 40, maxLines: 1, lineHeight: 1.3, color: stroke, spacing: 0.2, meta: true}, {kind: 'rise', beat: 0});
      const kw = k.text('keyword', f.keyword, {x, y: top + lab.size * 1.3 + u(10), width, preferred: 190, maxLines: 1, lineHeight: 1, color: WHITE}, {kind: 'rise', beat: 0});
      k.text('offer', f.offer, {x, y: top + lab.size * 1.3 + u(30) + kw.height, width, family: 'body', preferred: 52, maxLines: 3, lineHeight: 1.2, color: WHITE, weight: 600}, {kind: 'rise', beat: 1});
      if (k.hasLogo) k.logo('logo', {x: 0, y: 0, h: u(110), ground, maxWidth: x - u(40)}, {kind: 'fade', beat: 0});
      k.event('ask', k.beat(0), 'emphasis', 'pop');
      return ground;
    }
  }
];
