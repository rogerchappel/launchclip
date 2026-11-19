// Proves the sample's seams line up: puts rendered slides side by side and
// compares the columns either side of each seam.
//   node examples/carousel/seam-panorama-4x5/stitch.mjs <slides dir> [<other renderer's slides dir>] [--strip out.png]
// For each seam: the mean RGB step between the two seam columns, beside the
// mean step between neighbouring columns inside the slides; where the panorama
// runs across it, the largest difference from the plate itself over the
// ridges (rows clear of type). With a second dir, the mean difference per
// slide between the two renderers.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const story = JSON.parse(readFileSync(path.join(here, "storyboard.json"), "utf8"));
const args = process.argv.slice(2);
const stripAt = args.indexOf("--strip");
const strip = stripAt === -1 ? null : args.splice(stripAt, 2)[1];
const [dir, other] = args;
const { width: W, height: H } = story.format;
const raw = async (file) => (await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true })).data;
const pngs = (folder) => readdirSync(folder).filter((name) => /^\d+\.png$/.test(name)).sort().map((name) => path.join(folder, name));
const files = pngs(dir);
const slides = await Promise.all(files.map(raw));
const px = (x, y) => (y * W + x) * 3;
const colDiff = (a, xa, b, xb, rows) => {
  let sum = 0, max = 0;
  for (const y of rows) for (let c = 0; c < 3; c++) {
    const d = Math.abs(a[px(xa, y) + c] - b[px(xb, y) + c]);
    sum += d; max = Math.max(max, d);
  }
  return { mean: sum / (rows.length * 3), max };
};
const all = Array.from({ length: H }, (_, y) => y);
const ridges = all.filter((y) => y >= 880);
const [from, to] = story.carousel.panorama.slides;
const plate = await sharp(path.join(here, story.carousel.panorama.src)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const plateCol = (x) => { const out = Buffer.alloc(H * 3); for (const y of all) plate.data.copy(out, y * 3, (y * plate.info.width + x) * 3, (y * plate.info.width + x) * 3 + 3); return out; };

for (let i = 0; i + 1 < slides.length; i++) {
  const seam = colDiff(slides[i], W - 1, slides[i + 1], 0, all);
  const inside = colDiff(slides[i], W - 2, slides[i], W - 1, all);
  let line = `seam ${i + 1}|${i + 2}: step across ${seam.mean.toFixed(2)} (max ${seam.max}), inside the slide ${inside.mean.toFixed(2)}`;
  if (i + 1 >= from && i + 2 <= to && plate.info.width === (to - from + 1) * W) {
    let max = 0;
    for (const [s, x, plateX] of [[i, W - 1, (i - from + 1) * W + W - 1], [i + 1, 0, (i - from + 2) * W]]) {
      const col = plateCol(plateX);
      for (const y of ridges) for (let c = 0; c < 3; c++) max = Math.max(max, Math.abs(slides[s][px(x, y) + c] - col[y * 3 + c]));
    }
    line += `; vs the plate on the ridges: max ${max}`;
  }
  console.log(line);
}
if (other) {
  const theirs = await Promise.all(pngs(other).map(raw));
  slides.forEach((mine, i) => {
    let sum = 0;
    for (let k = 0; k < mine.length; k++) sum += Math.abs(mine[k] - theirs[i][k]);
    console.log(`slide ${i + 1}: mean |Δ| between renderers ${(sum / mine.length).toFixed(3)}`);
  });
}
if (strip) {
  await sharp({ create: { width: W * files.length, height: H, channels: 3, background: "#000" } }).composite(files.map((input, i) => ({ input, left: i * W, top: 0 }))).png().toFile(strip);
  console.log(`strip: ${strip}`);
}
