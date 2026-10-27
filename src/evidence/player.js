// Evidence capture, step 4: draw the timeline frame by frame and encode it.
//
// The player is a local HTML page (written next to the full-page screenshot
// in a work dir) that draws one frame for a time t: the dark browser chrome
// with the page's URL, the screenshot positioned by the camera, and the
// overlays (selection, highlight, focus ring, date pins, cursor) in window
// px. Everything is laid out per frame in px rather than with a CSS scale, so
// a 2.6× zoom re-samples the 2× screenshot instead of blowing up a bitmap.
// render(t) reads only the timeline (src/evidence/timeline.js, inlined), so
// each frame is drawn from scratch: seeking is safe and a re-run is
// identical. Frames are JPEG screenshots piped into the system ffmpeg.
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CHROME_HEIGHT = 52; // px at a 1000 px tall viewport; scaled with it

const TIMELINE_SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), "timeline.js");
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Chrome bar height for a viewport (0 without chrome). */
export const chromeHeight = (viewport, chrome = "dark") => (chrome === "none" ? 0 : Math.round((CHROME_HEIGHT * viewport.height) / 1000 / 2) * 2);

/** The URL as the bar shows it: {host, rest}, without the scheme or a trailing slash. */
export function urlParts(href) {
  const url = new URL(href);
  const rest = `${url.pathname === "/" ? "" : url.pathname}${url.search}`.replace(/\/$/, "");
  return { host: url.hostname.replace(/^www\./, ""), rest };
}

/** The player page's HTML. `image` is the screenshot's file name in the same dir. */
export async function playerHtml({ timeline, image, url, theme = "dark" }) {
  const source = (await readFile(TIMELINE_SOURCE, "utf8")).replace(/^export /gm, "");
  const { width, height } = timeline.viewport;
  const ch = timeline.chrome;
  const k = height / 1000;
  const { host, rest } = urlParts(url);
  const bar = ch ? `<div id="bar">
  <div id="dots"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
  <div id="nav"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg><svg viewBox="0 0 24 24" style="opacity:.35"><path d="M9 6l6 6-6 6"/></svg><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/></svg></div>
  <div id="url"><svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg><span class="host">${escapeHtml(host)}</span><span class="rest">${escapeHtml(rest)}</span></div>
</div>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${theme === "dark" ? "#0d0f12" : "#ffffff"}}
*{box-sizing:border-box}
#bar{position:absolute;left:0;top:0;width:${width}px;height:${ch}px;background:linear-gradient(#1b1e23,#15171b);border-bottom:1px solid #ffffff14;display:flex;align-items:center;font:500 ${Math.round(15 * k)}px -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif}
#dots{display:flex;gap:${Math.round(8 * k)}px;padding-left:${Math.round(20 * k)}px;width:${Math.round(150 * k)}px}
#dots i{display:block;width:${Math.round(12 * k)}px;height:${Math.round(12 * k)}px;border-radius:50%;opacity:.9}
#nav{display:flex;gap:${Math.round(10 * k)}px;width:${Math.round(110 * k)}px}
#nav svg{width:${Math.round(18 * k)}px;height:${Math.round(18 * k)}px;fill:none;stroke:#9aa0a9;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
#url{position:absolute;left:50%;transform:translateX(-50%);width:${Math.round(width * 0.46)}px;height:${Math.round(ch * 0.62)}px;border-radius:${Math.round(9 * k)}px;background:#0e1013;border:1px solid #ffffff12;display:flex;align-items:center;gap:${Math.round(8 * k)}px;padding:0 ${Math.round(14 * k)}px;white-space:nowrap;overflow:hidden}
#url svg{flex:none;width:${Math.round(14 * k)}px;height:${Math.round(14 * k)}px;fill:none;stroke:#8b919a;stroke-width:2}
#url .host{color:#e8eaed}#url .rest{color:#8b919a;overflow:hidden;text-overflow:ellipsis;margin-left:-${Math.round(8 * k)}px}
#win{position:absolute;left:0;top:${ch}px;width:${width}px;height:${height - ch}px;overflow:hidden}
#shot{position:absolute;left:0;top:0;max-width:none;image-rendering:auto}
.sel{position:absolute;background:rgba(56,132,255,.42);mix-blend-mode:normal}
.mark{position:absolute;background:rgba(34,211,238,.28);box-shadow:inset 0 -2px 0 #22d3ee;border-radius:2px}
#ring{position:absolute;border:${(2.5 * k).toFixed(2)}px solid #22d3ee;border-radius:${Math.round(8 * k)}px;box-shadow:0 0 0 ${Math.round(4 * k)}px rgba(34,211,238,.16),0 0 ${Math.round(22 * k)}px rgba(34,211,238,.55),inset 0 0 ${Math.round(12 * k)}px rgba(34,211,238,.18);display:none}
.pin{position:absolute;white-space:nowrap;padding:${Math.round(12 * k)}px ${Math.round(24 * k)}px;border-radius:999px;background:rgba(14,17,22,.88);border:1px solid rgba(255,255,255,.22);color:#fff;font:800 ${Math.round(28 * k)}px -apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif;letter-spacing:.01em;text-transform:uppercase;box-shadow:0 ${Math.round(10 * k)}px ${Math.round(30 * k)}px rgba(0,0,0,.55),0 0 0 1px rgba(34,211,238,.12);transform-origin:50% 50%}
#cursor{position:absolute;left:0;top:0;width:${Math.round(26 * k)}px;height:${Math.round(26 * k)}px;display:none;filter:drop-shadow(0 ${Math.round(2 * k)}px ${Math.round(3 * k)}px rgba(0,0,0,.45));transform-origin:${(3.5 * k).toFixed(1)}px ${(2.5 * k).toFixed(1)}px}
</style></head><body>${bar}
<div id="win"><img id="shot" src="${escapeHtml(image)}"><div id="marks"></div><div id="sels"></div><div id="ring"></div><div id="pins"></div>
<svg id="cursor" viewBox="0 0 26 26"><path d="M3.5 2.5 L3.5 20.5 L8.2 16.4 L11.6 23.6 L14.9 22.1 L11.6 15.1 L18 14.9 Z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg></div>
<script>
${source}
const TL = ${JSON.stringify(timeline)};
const $ = (id) => document.getElementById(id);
const pool = (parent, n, cls) => { while (parent.children.length < n) { const d = document.createElement('div'); d.className = cls; parent.appendChild(d); } [...parent.children].forEach((c, i) => { c.style.display = i < n ? 'block' : 'none'; }); return parent.children; };
const place = (node, r, cam) => { const a = toWindow({x: r.x, y: r.y}, cam, TL.win); node.style.left = a.x + 'px'; node.style.top = a.y + 'px'; node.style.width = r.width * cam.s + 'px'; node.style.height = r.height * cam.s + 'px'; return a; };
window.__render = (t) => {
  const st = stateAt(TL, t), cam = st.camera, v = viewOf(cam, TL.win);
  const shot = $('shot');
  shot.style.width = TL.page.width * cam.s + 'px';
  shot.style.left = (-v.x * cam.s) + 'px';
  shot.style.top = (-v.y * cam.s) + 'px';
  const marks = st.highlights.flat();
  [...pool($('marks'), marks.length, 'mark')].slice(0, marks.length).forEach((n, i) => place(n, marks[i], cam));
  [...pool($('sels'), st.selection.length, 'sel')].slice(0, st.selection.length).forEach((n, i) => place(n, st.selection[i], cam));
  const ring = $('ring');
  if (st.ring) { ring.style.display = 'block'; place(ring, st.ring.rect, cam); ring.style.opacity = st.ring.opacity; ring.style.transform = 'scale(' + st.ring.scale + ')'; } else ring.style.display = 'none';
  const pins = [...pool($('pins'), st.pins.length, 'pin')];
  st.pins.forEach((pin, i) => {
    const n = pins[i]; n.textContent = pin.label; n.style.opacity = pin.opacity; n.style.transform = 'scale(' + pin.scale + ')';
    const w = n.offsetWidth, h = n.offsetHeight, m = 28 * (TL.viewport.height / 1000);
    let x, y;
    if (pin.rect) {
      const a = toWindow({x: pin.rect.x + pin.rect.width, y: pin.rect.y + pin.rect.height / 2}, cam, TL.win);
      const b = toWindow({x: pin.rect.x, y: pin.rect.y}, cam, TL.win);
      x = a.x + m * 0.6; y = a.y - h / 2;
      if (x + w > TL.win.width - m) x = b.x - w - m * 0.6;
      // Pinned to the page: it scrolls and zooms away with what it marks.
      n.style.left = x + 'px'; n.style.top = y + 'px';
    } else {
      n.style.left = (TL.win.width - w - m * 1.4) + 'px'; n.style.top = (TL.win.height - h - m * 1.4) + 'px';
    }
  });
  const cur = $('cursor');
  if (st.cursor) { cur.style.display = 'block'; cur.style.opacity = st.cursor.opacity; cur.style.transform = 'translate(' + (st.cursor.x - 3.5) + 'px,' + (st.cursor.y - 2.5) + 'px)' + (st.cursor.down ? ' scale(.9)' : ''); } else cur.style.display = 'none';
};
window.__ready = $('shot').decode().then(() => true);
</script></body></html>`;
}

/**
 * Render a timeline to a video with a Playwright `browser`: every frame from
 * 0 to timeline.duration at `fps`, piped to ffmpeg. → {frames, duration}.
 * `.webm` outputs are VP9, anything else H.264.
 */
export async function renderClip(browser, { timeline, workDir, image, url, theme, out, poster, fps = 30, log = () => {} }) {
  const html = path.join(workDir, "player.html");
  await writeFile(html, await playerHtml({ timeline, image, url, theme }));
  const context = await browser.newContext({ viewport: { width: timeline.viewport.width, height: timeline.viewport.height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto(`file://${html}`);
    await page.evaluate(() => window.__ready);
    const frames = Math.round(timeline.duration * fps);
    const webm = /\.webm$/i.test(out);
    const codec = webm ? ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "28", "-row-mt", "1"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-movflags", "+faststart"];
    const ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-", "-vf", "format=yuv420p", ...codec, "-r", String(fps), out], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    ffmpeg.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
    const done = new Promise((resolve) => ffmpeg.on("close", resolve));
    for (let frame = 0; frame < frames; frame++) {
      await page.evaluate((t) => window.__render(t), frame / fps);
      const jpeg = await page.screenshot({ type: "jpeg", quality: 95 });
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
      if (frame % (fps * 2) === 0) log(`frame ${frame}/${frames}`);
    }
    ffmpeg.stdin.end();
    const code = await done;
    if (code !== 0) throw new Error(`ffmpeg failed to encode ${out}: ${stderr}`);
    if (poster) {
      // The poster is the clip's settled end state: every beat landed.
      await page.evaluate((t) => window.__render(t), Math.max(0, timeline.duration - 0.05));
      await page.screenshot({ path: poster, type: "png" });
    }
    return { frames, duration: Math.round((frames / fps) * 1000) / 1000 };
  } finally {
    await context.close().catch(() => {});
  }
}
