// Generates assets/panorama.jpg, the sample's panorama plate: one wide
// illustration (four 4:5 slides side by side, 4320×1350) of a night-to-dawn
// climb: stars, layered ridges with contour lines, and a trail to the summit.
// node examples/carousel/seam-panorama-4x5/make-plate.mjs
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const W = 4320, H = 1350;
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ridge = (base, amp, waves, rise = 0) => {
  const phases = waves.map(() => rand() * Math.PI * 2);
  return (x) => base - rise * (x / W) ** 1.6 - waves.reduce((sum, f, i) => sum + Math.sin((x / W) * f * Math.PI * 2 + phases[i]) * amp / (i + 1), 0);
};
const path = (fn, step = 12) => {
  let d = `M0 ${H} L0 ${fn(0).toFixed(1)}`;
  for (let x = step; x <= W; x += step) d += ` L${x} ${fn(x).toFixed(1)}`;
  return `${d} L${W} ${H} Z`;
};
const line = (fn, step = 12) => {
  let d = `M0 ${fn(0).toFixed(1)}`;
  for (let x = step; x <= W; x += step) d += ` L${x} ${fn(x).toFixed(1)}`;
  return d;
};
const stars = Array.from({ length: 260 }, () => {
  const x = rand() * W * 0.7, y = rand() * H * 0.5, r = rand() * 2.2 + 0.4;
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="#f4efe6" opacity="${(0.25 + rand() * 0.6 * (1 - x / (W * 0.7))).toFixed(2)}"/>`;
}).join("");
const far = ridge(860, 70, [3, 7, 13], 120);
const mid = ridge(1000, 90, [2, 5, 11], 260);
const near = ridge(1180, 60, [4, 9, 17], 80);
// The summit: the mid ridge's peak sits on the third seam's far side.
const peakX = 3460;
const summit = (x) => Math.min(mid(x), 430 + Math.abs(x - peakX) * 0.9);
const contours = (fn, from, count, gap, color) => Array.from({ length: count }, (_, i) => `<path d="${line((x) => fn(x) + from + i * gap)}" fill="none" stroke="${color}" stroke-width="1.6" opacity="${(0.5 - i * 0.03).toFixed(2)}"/>`).join("");
const trail = [[260, 1250], [900, 1160], [1500, 1120], [2050, 1010], [2600, 900], [3050, 700], [3300, 560], [peakX, summit(peakX) + 6]];
const trailD = trail.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="sky" x1="0" x2="1" y1="0" y2="0.35"><stop offset="0" stop-color="#0b1520"/><stop offset="0.45" stop-color="#16263a"/><stop offset="0.75" stop-color="#5a3a4a"/><stop offset="0.9" stop-color="#d9654a"/><stop offset="1" stop-color="#ffb36b"/></linearGradient>
  <radialGradient id="sun" cx="${(3900 / W).toFixed(3)}" cy="0.62" r="0.22"><stop offset="0" stop-color="#ffd8a0" stop-opacity="0.95"/><stop offset="1" stop-color="#ff7a45" stop-opacity="0"/></radialGradient>
  <linearGradient id="farG" x1="0" x2="1"><stop offset="0" stop-color="#1b2c40"/><stop offset="1" stop-color="#7a4552"/></linearGradient>
  <linearGradient id="midG" x1="0" x2="1"><stop offset="0" stop-color="#132131"/><stop offset="1" stop-color="#4a2a3a"/></linearGradient>
  <linearGradient id="nearG" x1="0" x2="1"><stop offset="0" stop-color="#0a131c"/><stop offset="1" stop-color="#22151f"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#sky)"/>
<rect width="${W}" height="${H}" fill="url(#sun)"/>
${stars}
<path d="${path(far)}" fill="url(#farG)"/>${contours(far, 26, 9, 22, "#2c4560")}
<path d="${path(summit)}" fill="url(#midG)"/>${contours(summit, 30, 14, 26, "#3b2f48")}
<path d="${trailD}" fill="none" stroke="#ffd166" stroke-width="5" stroke-dasharray="2 18" stroke-linecap="round" opacity="0.9"/>
<path d="${path(near)}" fill="url(#nearG)"/>${contours(near, 24, 6, 20, "#1d2a38")}
</svg>`;

const out = fileURLToPath(new URL("./assets/panorama.jpg", import.meta.url));
await sharp(Buffer.from(svg)).jpeg({ quality: 88, mozjpeg: true }).toFile(out);
console.log(out);
