// End-card layouts, loop-led family: no ask, the last frame leads back into
// the first (docs/END_CARDS_RFC.md §5.5). See end-card-layouts-type.mjs for
// the layout shape.

import {abs} from './catalog-b-view.mjs';

export const LOOP_LAYOUTS = [
  {
    id: 'seam', family: 'loop-led', grounds: ['footage', 'card'], actions: ['loop'], tags: ['editorial', 'calm'], needs: ['hook'],
    build(k) {
      const {W, H, u, fields: f} = k;
      const ground = k.ground('footage');
      k.scrim('to bottom', 0.8, 0.6);
      // Where a hook-title sits on frame 1: big display type in the upper third.
      k.text('hook', f.hook, {x: 0, y: H * 0.08, width: W, preferred: 170, maxLines: 4, lineHeight: 1.0, color: '#ffffff'}, {kind: 'rise', beat: 2});
      k.text('marker', '↺', {x: W - u(120), y: H - u(110), width: u(120), family: 'meta', preferred: 64, maxLines: 1, color: '#ffffff', align: 'right', meta: true, style: {opacity: 0.7}}, {kind: 'fade', beat: 3});
      k.event('ask', k.beat(2), 'emphasis', 'whoosh-soft');
      return ground;
    }
  },
  {
    id: 'rewind', family: 'loop-led', grounds: ['footage'], actions: ['loop'], tags: ['playful', 'loud'], needs: ['hook'],
    build(k) {
      const {W, H, u, fields: f, colors: c, full} = k;
      const ground = k.ground('footage');
      k.node('div', null, abs(full.x, full.y, full.width, full.height, {background: `repeating-linear-gradient(0deg, #000000a0 0px, #000000a0 ${u(4)}px, #00000050 ${u(4)}px, #00000050 ${u(12)}px)`}));
      k.text('counter', '◀◀ 00:00', {x: 0, y: 0, width: W * 0.6, family: 'meta', preferred: 52, maxLines: 1, color: '#ffffff', spacing: 0.08, meta: true},
        {kind: 'count', beat: 0, values: ['◀◀ 00:41', '◀◀ 00:33', '◀◀ 00:24', '◀◀ 00:16', '◀◀ 00:08', '◀◀ 00:00'], step: 0.12});
      const shadow = `${u(6)}px 0 ${c.primary}cc, ${-u(6)}px 0 ${c.accent}aa`;
      k.text('hook', f.hook, {x: 0, y: H * 0.32, width: W, preferred: 160, maxLines: 4, lineHeight: 1.0, color: '#ffffff', style: {textShadow: shadow}}, {kind: 'fade', beat: 3});
      if (k.hasLogo) k.logo('logo', {x: W / 2, y: H - u(120), h: u(100), align: 'center', ground}, {kind: 'fade', beat: 4});
      k.event('ask', k.beat(3), 'emphasis', 'tape-stop');
      return ground;
    }
  }
];
