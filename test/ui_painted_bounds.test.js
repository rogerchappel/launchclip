// Every ui-scene kind paints inside its rect: the layout checks see each
// element at its rect (uiTiltBox, uiStageBox), so a part painted outside it
// (a slot in the caption band, a reply bubble under the next panel) is
// invisible to them. Paints each kind in Chromium at its smallest legible size
// (MIN_SIZE) and at a roomier one, at settled times and mid-animation, and
// measures the union of what is drawn, clipped by any ancestor that clips.
import assert from "node:assert/strict";
import test from "node:test";
import { MIN_SIZE, uiTheme } from "@launchclip/core/catalog-i-ui.mjs";
import { UI_KINDS, UI_RUNTIME } from "@launchclip/core/ui-runtime.mjs";
import { recorderAvailability } from "../src/demo/record.js";
import { mediaSkip } from "./helpers/media.js";

const available = await recorderAvailability();
const needsBrowser = { skip: mediaSkip(!available.ok && `Chromium unavailable: ${available.reasons.join("; ")}`), timeout: 120000 };

// Props that draw every part a kind has (titles, counters, replies with links, markers near the edges).
const PROPS = {
  headline: { text: "REAL SOUND", size: 90 },
  chip: { text: "ON BEAT" },
  waveform: { clipAt: 1 },
  window: { title: "preview", sub: "sfx", right: "00:00:01" },
  timeline: { title: "sequence_01", sub: "sfx pass", clipAt: 1, timecode: "00:00:01:00", tracks: [{ label: "V2", kind: "video", clips: [{ label: "title_card", x: 0.02, width: 0.4 }] }, { label: "A1", kind: "audio", name: "voice.wav" }, { label: "A2", kind: "sfx", clips: [{ label: "BOING!", x: 0.04, width: 0.26, tone: "alert", rotate: -6 }, { label: "DING!", x: 0.72, width: 0.26, tone: "alert", rotate: 4 }] }], meter: { level: 7, alertAt: 1 }, playhead: { from: 0.08, to: 0.95, at: 0, dur: 3 } },
  "lock-cards": { title: "sound-toolkit", sub: "tools", cards: [{ name: "tool_01", tag: "FREE", unlockAt: 1 }, { name: "tool_02", tag: "FREE", unlockAt: 2.5 }, { name: "tool_03", tag: "FREE" }] },
  stack: {},
  meter: { title: "LEVEL", settleAt: 0.5 },
  terminal: { title: "terminal", sub: "agent", prompt: "make a brand new whoosh", lines: [{ key: "›", text: "no match in library" }, { key: "›", text: "building it from code" }], output: { label: "brand_new.wav" } },
  results: { query: "whoosh", cards: [{ label: "whoosh_01", sub: "CC0", badge: "CC0" }, { label: "whoosh_02", badge: "CC BY", tone: "accent" }, { label: "whoosh_03", badge: "CC0" }] },
  "card-wall": { count: 32, cols: 4, highlightAt: 1 },
  downloads: { title: "downloads", prompt: "find 3 punchy whooshes", items: [{ label: "whoosh_01.wav", sub: "CC BY", pick: true }, { label: "whoosh_02.wav", sub: "CC0", pick: true }, { label: "whoosh_03.wav" }], selectAt: 0.5 },
  comment: { text: "SOUND", typeAt: 0.1, sendAt: 1, reply: "Here are the links", replyAt: 1.5, links: ["Open link", "Docs"] },
  "marker-snap": { snapAt: 0.5 },
  "frame-ruler": { snapAt: 0.5, pin: "HIT · F 0547" },
  "pad-grid": { runAt: 0.5 },
  "scan-plane": { scanAt: 2, scanDur: 3, markers: [{ label: "intro", x: 0.02, at: 1.6 }, { label: "logo", x: 0.48, at: 1.8 }, { label: "outro", x: 0.99, at: 2 }] },
  bloom: {},
  host: { pose: "cheer" },
  cutout: { view: [100, 100], edge: 0, parts: [{ shape: "circle", x: 50, y: 50, r: 45, fill: "accent" }] },
  "torn-strip": { text: "TORN", size: 30 },
  tape: {}
};
// Light and groups: a bloom and a burst swell past their rect by design and are not layout parts; a stack draws only its children.
// Paper runs in 3D: a fold's panels turn out of the plane, a limb sways, a pin's line reaches its target.
const EXEMPT = new Set(["bloom", "burst", "stack", "paper-fold", "paper-sheet", "limb", "callout-pin"]);
// Kinds without a smallest size, measured at a typical one.
const TYPICAL = { "pad-grid": { width: 490, height: 430 }, headline: { width: 900, height: 120 }, chip: { width: 320, height: 64 }, waveform: { width: 900, height: 220 }, window: { width: 740, height: 440 }, "card-wall": { width: 900, height: 900 } };
// Settled, mid-change (an unlock, the scan running) and late; no part is mid-entrance.
const TIMES = [2.6, 3.5, 6];

test("ui-scene: every kind paints inside its rect, at its smallest legible size and roomier", needsBrowser, async (t) => {
  const browser = await available.chromium.launch({ executablePath: available.executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.setContent('<html><body style="margin:0"><div id="h" style="position:relative;width:1080px;height:1920px"></div></body></html>');
  await page.addScriptTag({ content: UI_RUNTIME });
  const theme = uiTheme({ bg: "#0a0b08", paper: "#f4f6ee", accent: "#c8ff3a" });
  const kinds = UI_KINDS.filter((kind) => !EXEMPT.has(kind));
  assert.deepEqual(kinds.filter((kind) => !PROPS[kind]), [], "every kind has props here");
  const failures = [];
  for (const kind of kinds) {
    const min = MIN_SIZE[kind] ?? TYPICAL[kind] ?? { width: 600, height: 400 };
    // The comment's smallest rect depends on its parts: 0.75 of what they stack to.
    const smallest = kind === "comment" ? { width: min.width, height: 364 } : min;
    for (const size of [smallest, { width: Math.max(smallest.width, 900), height: Math.round(smallest.height * 1.8) }]) {
      const rect = { x: 90, y: 200, ...size };
      const spec = { start: 0, width: 1080, height: 1920, unit: 1, theme, fonts: { display: "sans-serif", body: "sans-serif", mono: "monospace" }, elements: [{ kind, rect, at: 0, enter: "cut", props: PROPS[kind], beats: [] }] };
      for (const time of TIMES) {
        const box = await page.evaluate(([spec, time]) => {
          const host = document.getElementById("h");
          window.lcPaintUi(host, spec, time);
          const root = host.querySelector("[data-ui]");
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const node of root.querySelectorAll("*")) {
            const r = node.getBoundingClientRect();
            if (r.width < 0.5 || r.height < 0.5) continue;
            const style = getComputedStyle(node);
            // An empty, unpainted box (a layout wrapper) draws nothing.
            if (!node.childElementCount && !node.textContent.trim() && style.backgroundColor === "rgba(0, 0, 0, 0)" && style.backgroundImage === "none" && style.borderStyle === "none") continue;
            let a = { l: r.left, t: r.top, r: r.right, b: r.bottom };
            for (let p = node.parentElement; p && p !== host; p = p.parentElement) {
              if (getComputedStyle(p).overflow === "visible") continue;
              const q = p.getBoundingClientRect();
              a = { l: Math.max(a.l, q.left), t: Math.max(a.t, q.top), r: Math.min(a.r, q.right), b: Math.min(a.b, q.bottom) };
            }
            if (a.r - a.l < 0.5 || a.b - a.t < 0.5) continue;
            x0 = Math.min(x0, a.l); y0 = Math.min(y0, a.t); x1 = Math.max(x1, a.r); y1 = Math.max(y1, a.b);
          }
          return { x0, y0, x1, y1 };
        }, [spec, time]);
        const over = { left: rect.x - box.x0, top: rect.y - box.y0, right: box.x1 - rect.x - rect.width, bottom: box.y1 - rect.y - rect.height };
        // A host jumps and throws sparkles as it reacts: it may reach a third of its height above its rect and a sixth of its width to each side, and its contact shadow sits just under its feet.
        const room = kind === "host" ? { left: size.width / 6, top: size.height / 3, right: size.width / 6, bottom: 6 } : { left: 2, top: 2, right: 2, bottom: 2 };
        if (Object.entries(over).some(([side, v]) => v > room[side] && v > 2)) failures.push(`${kind} ${size.width}×${size.height} at ${time} s paints past its rect by ${JSON.stringify(Object.fromEntries(Object.entries(over).map(([k, v]) => [k, Math.round(v)])))}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
