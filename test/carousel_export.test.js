import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { run, cardSheet, postCaption, META_CARD_HEADLINE, META_CARD_DESCRIPTION } from "../src/carousel/export.js";
import { writePdf } from "../src/carousel/pdf.js";

const sample = () => JSON.parse(readFileSync(new URL("../examples/carousel/listicle-4x5/storyboard.json", import.meta.url), "utf8"));
const png = (width, height) => sharp({ create: { width, height, channels: 3, background: "#e2412b" } }).png().toBuffer();

// A project with the sample story and fake renders for the given destinations.
async function project(story, renders) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "carousel-export-"));
  writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(story));
  for (const [dest, files] of Object.entries(renders)) {
    mkdirSync(path.join(dir, "carousel", dest), { recursive: true });
    for (const file of files) writeFileSync(path.join(dir, "carousel", dest, file), file.endsWith(".mp4") ? "mp4" : await png(108, 135));
  }
  return dir;
}
const stems = (n, ext = "png") => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(2, "0")}.${ext}`);

// Reads a PDF back: every xref offset points at its object, and each page's MediaBox.
function parsePdf(buffer) {
  const text = buffer.toString("latin1");
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.ok(text.startsWith("xref", startxref), "startxref points at the xref table");
  const [, , count] = /xref\n(\d+) (\d+)/.exec(text.slice(startxref)).map(Number);
  const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, count - 1);
  offsets.forEach((offset, i) => assert.ok(text.startsWith(`${i + 1} 0 obj`, offset), `object ${i + 1} is at its xref offset`));
  const pages = [...text.matchAll(/\/Type \/Page \/Parent 2 0 R \/MediaBox \[0 0 (\d+) (\d+)\]/g)].map((m) => ({ width: Number(m[1]), height: Number(m[2]) }));
  assert.equal(Number(/\/Count (\d+)/.exec(text)[1]), pages.length);
  return { pages, images: (text.match(/\/Filter \/DCTDecode/g) ?? []).length };
}

test("writePdf: one page per slide at the slide's size, parsed back", async () => {
  const jpeg = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#000" } }).jpeg().toBuffer();
  const parsed = parsePdf(writePdf([{ jpeg, width: 40, height: 50 }, { jpeg, width: 40, height: 50 }, { jpeg, width: 60, height: 60 }]));
  assert.deepEqual(parsed.pages, [{ width: 40, height: 50 }, { width: 40, height: 50 }, { width: 60, height: 60 }]);
  assert.equal(parsed.images, 3);
});

test("export writes slides, PDF, caption and alt per destination, and CAROUSEL.json", async () => {
  const story = sample();
  const n = story.scenes.length;
  const dir = await project(story, { instagram: stems(n), linkedin: stems(n) });
  try {
    const out = [];
    const report = await run(dir, {}, { stdout: { write: (s) => out.push(s) } });
    assert.match(out.join(""), /instagram: 01\.png/);
    const linkedin = report.destinations.linkedin;
    assert.equal(linkedin.status, "exported");
    assert.deepEqual(linkedin.files.slice(0, n), stems(n));
    assert.ok(linkedin.files.includes("slides.pdf"));
    const pdf = parsePdf(readFileSync(path.join(dir, "carousel/linkedin/slides.pdf")));
    assert.equal(pdf.pages.length, n);
    assert.deepEqual(pdf.pages[0], { width: 108, height: 135 });
    assert.ok(!report.destinations.instagram.files.includes("slides.pdf"));
    const alt = JSON.parse(readFileSync(path.join(dir, "carousel/instagram/alt.json"), "utf8"));
    assert.equal(alt.length, n);
    assert.equal(alt[0].alt, story.scenes[0].slide.alt);
    const written = JSON.parse(readFileSync(path.join(dir, "carousel/CAROUSEL.json"), "utf8"));
    assert.deepEqual(Object.keys(written.destinations), ["instagram", "linkedin"]);
    assert.equal(written.slides.length, n);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a destination missing its renders is skipped; the others still export", async () => {
  const story = sample();
  const n = story.scenes.length;
  const dir = await project(story, { instagram: stems(n).slice(1) });
  writeFileSync(path.join(dir, "carousel/check.json"), JSON.stringify({ ok: true }));
  try {
    const report = await run(dir, { dest: "instagram,threads" }, {});
    assert.equal(report.destinations.instagram.status, "skipped");
    assert.match(report.destinations.instagram.missing[0], /slide 1 \(cover\): 01\.png/);
    assert.equal(report.destinations.threads.status, "skipped");
    assert.deepEqual(report.check, { ok: true });
    assert.ok(existsSync(path.join(dir, "carousel/CAROUSEL.json")));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a motion slide: mp4 where the destination shows motion, its still where it does not", async () => {
  const story = sample();
  const n = story.scenes.length;
  Object.assign(story.scenes[1], { loop: true });
  story.scenes[1].slide.medium = "motion";
  const dir = await project(story, { instagram: [...stems(n), "02.mp4"], tiktok: stems(n), linkedin: stems(n), "meta-ads": [...stems(n), "02.mp4"] });
  try {
    const report = await run(dir, { dest: "instagram,tiktok,linkedin,meta-ads" }, {});
    assert.deepEqual(report.destinations.instagram.files.slice(0, n + 1), ["01.png", "02.png", "02.mp4", ...stems(n).slice(2)]);
    assert.deepEqual(report.destinations.tiktok.files.slice(0, n), stems(n, "jpg"), "tiktok takes jpg, made from the png");
    assert.ok(existsSync(path.join(dir, "carousel/tiktok/02.jpg")));
    assert.ok(!report.destinations.linkedin.files.includes("02.mp4"));
    assert.ok(report.destinations.linkedin.warnings.some((w) => w.includes("sent as its still")));
    const alt = JSON.parse(readFileSync(path.join(dir, "carousel/instagram/alt.json"), "utf8"));
    assert.deepEqual(alt.filter((a) => a.slide === 2).map((a) => a.file), ["02.png", "02.mp4"]);
    // The Meta card is the clip, with its still as the thumbnail; still cards have none.
    const cards = JSON.parse(readFileSync(path.join(dir, "carousel/meta-ads/cards.json"), "utf8")).cards;
    assert.deepEqual(cards.slice(0, 3).map((card) => [card.file, card.thumbnail]), [["01.png", undefined], ["02.mp4", "02.png"], ["03.png", undefined]]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // A motion slide with no mp4 is a missing render where motion is shown.
  const bare = await project(story, { instagram: stems(n) });
  try {
    const report = await run(bare, { dest: "instagram" }, {});
    assert.equal(report.destinations.instagram.status, "skipped");
    assert.match(report.destinations.instagram.missing[0], /02\.mp4/);
  } finally { rmSync(bare, { recursive: true, force: true }); }
});

test("caption: hook flagged past the preview, tags only where the platform uses them", () => {
  const story = sample();
  const instagram = postCaption(story, "instagram");
  assert.equal(instagram.over, false);
  assert.deepEqual(instagram.tags, ["#productivity", "#engineering"]);
  assert.equal(instagram.plain.split("\n\n")[0], story.carousel.caption.hook);
  assert.match(instagram.plain, /#productivity #engineering$/);
  assert.match(instagram.markdown, /## Ready to paste/);
  const linkedin = postCaption(story, "linkedin");
  assert.deepEqual(linkedin.tags, []);
  assert.doesNotMatch(linkedin.plain, /#/);
  story.carousel.caption.hook = "x".repeat(130);
  const long = postCaption(story, "instagram");
  assert.equal(long.over, true);
  assert.match(long.markdown, /Over the preview/);
  assert.equal(postCaption(story, "x").over, false, "x shows 280 before the cut");
});

test("cards: within Meta's lengths, a link per card, more than 10 is an error", async () => {
  const story = sample();
  story.scenes[1].params.headline = "A headline that is far too long for a Meta carousel card";
  story.scenes[1].params.subhead = "A description past the card limit";
  const sheet = cardSheet(story, stems(story.scenes.length), "https://example.com");
  assert.equal(sheet.cards.length, story.scenes.length);
  for (const card of sheet.cards) {
    assert.ok(card.headline.length <= META_CARD_HEADLINE, card.headline);
    assert.ok(card.description.length <= META_CARD_DESCRIPTION, card.description);
    assert.equal(card.link, "https://example.com");
  }
  assert.ok(sheet.cards[1].headline.endsWith("…"));
  assert.equal(sheet.cards.at(-1).description.length > 0, true, "the cta card takes the caption's cta");
  assert.ok(sheet.warnings.some((w) => w.includes("card 2 headline cut")));
  assert.ok(cardSheet(story, [], null).warnings.some((w) => w.includes("--link")));
  const many = sample();
  many.scenes = Array.from({ length: 11 }, (_, i) => ({ ...many.scenes[1], id: `s${i}` }));
  assert.throws(() => cardSheet(many, [], null), /at most 10 cards/);

  const dir = await project(story, { "meta-ads": stems(story.scenes.length) });
  try {
    const report = await run(dir, { dest: "meta-ads", link: "https://example.com" }, {});
    assert.equal(report.destinations["meta-ads"].status, "exported");
    const written = JSON.parse(readFileSync(path.join(dir, "carousel/meta-ads/cards.json"), "utf8"));
    assert.equal(written.cards[0].file, "01.png");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
