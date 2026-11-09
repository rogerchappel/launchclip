// The media research finds reaches the planner and the publish manifest:
// staged files, what each shows and supports, licence and credit, and nothing
// with an unknown or incompatible licence is ever placed.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runMake } from "../src/make/index.js";
import { writePublishManifest } from "../src/publish_manifest.js";
import { buildCaptureRequests } from "../src/research/capture.js";
import { claimMediaQueries } from "../src/research/media.js";
import { mediaCredits, mediaLicenceErrors, placeable, researchMediaLines, stageResearchMedia } from "../src/research/stage_media.js";
import { PROMPT, assetsDir, fakeFinish, fakeInventory, fakeModel } from "./helpers/make_fakes.js";

const CC = { id: "cc-by-sa", name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };
const asset = (id, extra = {}) => ({ id, type: "image", title: `Title ${id}`, author: "A. Photographer", licence: CC, source_url: `https://commons.wikimedia.org/wiki/File:${id}.jpg`, media_url: `https://upload.wikimedia.org/${id}.jpg`, provider: "wikimedia-commons", provider_name: "Wikimedia Commons", query: "harbour", beat: null, attribution: `“Title ${id}” by A. Photographer, CC BY-SA 4.0, via Wikimedia Commons`, ...extra });
const MANIFEST = () => ({
  schema: "launchclip.research-assets.v1",
  assets: [
    asset("harbour", { preview_url: "https://upload.wikimedia.org/thumb/harbour-1920.jpg", width: 4000, height: 3000, claims: ["c001"] }),
    asset("launch", { type: "video", provider: "nasa", provider_name: "NASA Image and Video Library", licence: { id: "nasa-media", name: "NASA media (not copyrighted; no endorsement implied)", url: "https://www.nasa.gov/" }, author: "NASA KSC", source_url: "https://images.nasa.gov/details/launch", media_url: "https://images-assets.nasa.gov/video/launch/collection.json", attribution: "“Title launch”, NASA KSC, NASA media, via NASA Image and Video Library" }),
    asset("film", { type: "video", provider: "internet-archive", provider_name: "Internet Archive", licence: { id: "public-domain", name: "Public domain", url: null }, author: "Prelinger Archives", source_url: "https://archive.org/details/film_1950", media_url: "https://archive.org/download/film_1950" }),
    // Someone edited the file: a non-commercial licence, an unlabelled item and a video host must never be staged.
    asset("nc", { licence: { id: "cc-by-nc", name: "CC BY-NC 4.0", url: null } }),
    asset("unlabelled", { licence: null }),
    asset("tube", { source_url: "https://www.youtube.com/watch?v=abc", media_url: "https://www.youtube.com/watch?v=abc" }),
    asset("huge", { media_url: "https://upload.wikimedia.org/huge.png" }),
    asset("page", { media_url: "https://upload.wikimedia.org/page.jpg" })
  ],
  people: []
});
const LEDGER = { claims: [{ id: "c001", text: "The harbour reopened on November 6, 2026.", status: "verified", entities: [{ name: "Port Authority", kind: "org" }], sources: [] }] };

function fakeFetch(asked = []) {
  const bytes = (type, size = 2048) => new Response(new Uint8Array(size).fill(7), { status: 200, headers: { "content-type": type, "content-length": String(size) } });
  return async (url) => {
    asked.push(url);
    if (url === "https://upload.wikimedia.org/thumb/harbour-1920.jpg") return bytes("image/jpeg");
    if (url === "https://images-assets.nasa.gov/video/launch/collection.json") return Response.json(["http://images-assets.nasa.gov/video/launch/launch~orig.mp4", "http://images-assets.nasa.gov/video/launch/launch~medium.mp4", "http://images-assets.nasa.gov/video/launch/launch~thumb.jpg"]);
    if (url === "https://images-assets.nasa.gov/video/launch/launch~medium.mp4") return bytes("video/mp4");
    if (url === "https://archive.org/metadata/film_1950") return Response.json({ files: [{ name: "film_1950.thumbs/film_000001.jpg", size: "900" }, { name: "film_1950_512kb.mp4", size: "900000" }, { name: "film_1950.mp4", size: "90000000" }] });
    if (url === "https://archive.org/download/film_1950/film_1950_512kb.mp4") return bytes("video/mp4");
    if (url === "https://upload.wikimedia.org/huge.png") return new Response("", { status: 200, headers: { "content-type": "image/png", "content-length": String(900 * 1024 * 1024) } });
    if (url === "https://upload.wikimedia.org/page.jpg") return bytes("text/html");
    return new Response("", { status: 404 });
  };
}

async function project(manifest = MANIFEST()) {
  const root = await mkdtemp(path.join(os.tmpdir(), "launchclip-stage-media-"));
  await mkdir(path.join(root, "research"), { recursive: true });
  await writeFile(path.join(root, "research", "assets.json"), JSON.stringify(manifest));
  return root;
}

test("staging downloads only licence-clear items into assets/research and records where each went", async () => {
  const root = await project();
  try {
    const asked = [];
    const { staged, skipped } = await stageResearchMedia(path.join(root, "research"), root, {}, { fetch: fakeFetch(asked) });
    assert.deepEqual(staged.map((entry) => entry.local), ["assets/research/harbour.jpg", "assets/research/launch.mp4", "assets/research/film.mp4"]);
    for (const entry of staged) assert.ok(existsSync(path.join(root, entry.local)));
    assert.deepEqual(skipped.map((entry) => [entry.id, entry.reason.split(" (")[0].split(",")[0]]), [["nc", "licence not clear"], ["unlabelled", "licence not clear"], ["tube", "blocked host"], ["huge", "the file could not be downloaded"], ["page", "not an image file the kit can show"]]);
    // Nothing was asked of a host for an item that may not be used.
    assert.ok(!asked.some((url) => /youtube|\/nc\.jpg|unlabelled/.test(url)));
    const written = JSON.parse(await readFile(path.join(root, "research", "assets.json"), "utf8"));
    assert.equal(written.assets[0].local, "assets/research/harbour.jpg");
    assert.match(written.assets[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(written.assets[3].not_staged, "licence not clear");
    // A second run keeps what is on disk and asks for nothing already staged.
    asked.length = 0;
    const again = await stageResearchMedia(path.join(root, "research"), root, {}, { fetch: fakeFetch(asked) });
    assert.equal(again.staged.length, 3);
    assert.ok(!asked.some((url) => /harbour|launch~|512kb/.test(url)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the planner inventory says what each item shows, the claim it supports, and its licence and credit", async () => {
  const root = await project();
  try {
    await stageResearchMedia(path.join(root, "research"), root, {}, { fetch: fakeFetch() });
    const manifest = JSON.parse(await readFile(path.join(root, "research", "assets.json"), "utf8"));
    const lines = researchMediaLines(manifest, LEDGER);
    assert.deepEqual(lines.map((item) => [item.src, item.kind]), [["assets/research/harbour.jpg", "image"], ["assets/research/launch.mp4", "video"], ["assets/research/film.mp4", "video"]]);
    assert.match(lines[0].line, /^assets\/research\/harbour\.jpg — image, archive photo "Title harbour" from Wikimedia Commons, 4000×3000, found for "harbour"\. Supports claim c001 \("The harbour reopened on November 6, 2026\."\)\. Licence: CC BY-SA 4\.0; credit "“Title harbour” by A\. Photographer, CC BY-SA 4\.0, via Wikimedia Commons" \(publish\.json carries it\)\. Use as \{"module": "media-window"/);
    assert.match(lines[0].line, /"module": "photo-scene", "params": \{"media": \{"kind": "image", "src": "assets\/research\/harbour\.jpg"\}/);
    assert.match(lines[1].line, /archive footage "Title launch" from NASA Image and Video Library.*Illustration only: it is not evidence for any claim\./);
    // An entry that is not staged, or whose licence is not clear, is never offered.
    assert.equal(placeable(manifest.assets[3]), false);
    assert.equal(placeable({ ...manifest.assets[0], licence: { id: "cc-by-nc" } }), false);
    assert.equal(placeable({ ...manifest.assets[0], attribution: "" }), false);
    assert.equal(placeable({ ...manifest.assets[0], local: "assets/other/x.jpg" }), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a storyboard that places research media without a cleared licence is an error, and credits follow what is used", () => {
  const manifest = { assets: [asset("harbour", { local: "assets/research/harbour.jpg" }), asset("nc", { local: "assets/research/nc.jpg", licence: { id: "cc-by-nc", name: "CC BY-NC 4.0" } })] };
  const story = { scenes: [{ module: "media-window", params: { media: { kind: "image", src: "assets/research/harbour.jpg" } } }, { module: "photo-scene", params: { media: { kind: "image", src: "./assets/research/nc.jpg" } } }, { module: "photo-scene", params: { media: { kind: "image", src: "assets/research/stray.jpg" } } }, { module: "media-window", params: { media: { kind: "image", src: "assets/shot.png" } } }] };
  assert.deepEqual(mediaLicenceErrors(story, manifest), [
    "assets/research/nc.jpg is placed in the storyboard but its licence (CC BY-NC 4.0) is not one a video may use; remove it",
    "assets/research/stray.jpg is placed in the storyboard but has no licence on record in research/assets.json; remove it"
  ]);
  assert.deepEqual(mediaCredits(story, manifest), [{ asset: "assets/research/harbour.jpg", title: "Title harbour", author: "A. Photographer", licence: "CC BY-SA 4.0", licence_url: CC.url, source_url: "https://commons.wikimedia.org/wiki/File:harbour.jpg", attribution: "“Title harbour” by A. Photographer, CC BY-SA 4.0, via Wikimedia Commons" }]);
  assert.deepEqual(mediaLicenceErrors({ scenes: [story.scenes[0]] }, manifest), []);
});

test("publish.json carries the credits of the media used and the sources of the pages shown", async () => {
  const root = await project({ assets: [asset("harbour", { local: "assets/research/harbour.jpg" })], people: [] });
  try {
    await mkdir(path.join(root, "assets", "evidence"), { recursive: true });
    await writeFile(path.join(root, "assets", "evidence", "port.evidence.json"), JSON.stringify({ final_url: "https://port.example/news/reopening", captured_at: "2026-11-10T01:00:00.000Z", provenance: { source_title: "Harbour reopens", publisher: "Port Authority", published_at: "2026-11-06T00:00:00.000Z" } }));
    const story = { title: "The harbour reopens", format: { width: 1920, height: 1080, duration: 20 }, scenes: [
      { module: "photo-scene", params: { media: { kind: "image", src: "assets/research/harbour.jpg" } } },
      { module: "evidence-clip", params: { media: { src: "assets/evidence/port.mp4" } } },
      { module: "photo-scene", params: { media: { kind: "image", src: "assets/research/unknown.jpg" } } }
    ] };
    await writeFile(path.join(root, "storyboard.json"), JSON.stringify(story));
    const { manifest } = await writePublishManifest(root);
    assert.deepEqual(manifest.credits.map((credit) => [credit.asset, credit.licence]), [["assets/research/harbour.jpg", "CC BY-SA 4.0"]]);
    assert.match(manifest.description, /\n\nMedia: “Title harbour” by A\. Photographer, CC BY-SA 4\.0, via Wikimedia Commons$/);
    assert.deepEqual(manifest.sources, [{ clip: "assets/evidence/port.mp4", url: "https://port.example/news/reopening", title: "Harbour reopens", publisher: "Port Authority", published_at: "2026-11-06T00:00:00.000Z", captured_at: "2026-11-10T01:00:00.000Z" }]);
    assert.ok(manifest.warnings.includes("licence: assets/research/unknown.jpg is placed in the storyboard but has no licence on record in research/assets.json; remove it"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("media is looked for on what verified claims are about, and capture requests name the claims they back", () => {
  const ledger = { claims: [
    { id: "c001", text: "The Port Authority reopened Northside Harbour.", status: "verified", entities: [{ name: "Port Authority", kind: "org" }, { name: "Northside Harbour", kind: "name" }], sources: [{ url: "https://port.example/news", title: "News", publisher: "Port Authority", fetched_at: "2026-11-10T00:00:00.000Z", kind: "article", primary: true, supports: true, confidence: 0.9, quote: { text: "The Port Authority reopened Northside Harbour." } }] },
    { id: "c002", text: "The Port Authority spent $4 million.", status: "verified", entities: [{ name: "Port Authority", kind: "org" }], values: [{ raw: "$4 million", value: 4e6, unit: "usd" }], sources: [{ url: "https://port.example/news", title: "News", publisher: "Port Authority", fetched_at: "2026-11-10T00:00:00.000Z", kind: "article", primary: true, supports: true, confidence: 0.9, quote: { text: "The Port Authority spent $4 million." } }] },
    { id: "c003", text: "Nimbus-7B scores 71.4.", status: "verified", entities: [{ name: "Nimbus-7B", kind: "model" }], sources: [] },
    { id: "c004", text: "The Tide Board objected.", status: "unverified", entities: [{ name: "Tide Board", kind: "org" }], sources: [] }
  ] };
  assert.deepEqual(claimMediaQueries(ledger), [{ query: "Port Authority", beat: "The Port Authority reopened Northside Harbour.", claims: ["c001", "c002"] }]);
  const { requests } = buildCaptureRequests(ledger);
  assert.deepEqual(requests.map((request) => request.claims), [["c001", "c002"]]);
});

test("make stages research's media and lists it for the planner; nothing unclear reaches the manifest", async () => {
  const assets = await assetsDir();
  const cwd = await mkdtemp(path.join(os.tmpdir(), "launchclip-make-media-"));
  try {
    const { calls, model } = fakeModel();
    const ledger = { schema: "launchclip.evidence.v1", summary: { claims: 1, verified: 1, contradicted: 0, unverified: 0, sources_checked: 1, primary_sources: 1, web_search: null }, excerpts: [], claims: [{ id: "c001", text: "Ledgerly reconciles Stripe payouts automatically.", kind: "entity", status: "verified", confidence: 0.9, values: [], entities: [], sources: [{ url: "https://ledgerly.example/docs", publisher: "Ledgerly", primary: true, supports: true, confidence: 0.9, quote: { text: "Ledgerly reconciles Stripe payouts automatically." } }] }] };
    const research = async (briefFile, options) => {
      await mkdir(options.out, { recursive: true });
      await writeFile(path.join(options.out, "evidence.json"), JSON.stringify(ledger));
      await writeFile(path.join(options.out, "assets.json"), JSON.stringify({ schema: "launchclip.research-assets.v1", assets: [asset("harbour", { preview_url: "https://upload.wikimedia.org/thumb/harbour-1920.jpg", claims: ["c001"] }), asset("nc", { licence: { id: "cc-by-nc", name: "CC BY-NC 4.0" } })], people: [] }));
      return { summary: ledger.summary };
    };
    const report = await runMake(PROMPT, { assets, voice: "test", music: "synth", cwd, research: "on" }, { env: {}, client: model, inventory: fakeInventory, finish: fakeFinish([]), notice: () => {}, research, fetch: fakeFetch() });
    assert.deepEqual(report.research.media.staged.map((entry) => [entry.file, entry.licence, entry.claims]), [["assets/research/harbour.jpg", "CC BY-SA 4.0", ["c001"]]]);
    assert.deepEqual(report.research.media.skipped, [{ id: "nc", reason: "licence not clear" }]);
    assert.equal(report.research.media.offered, 1);
    assert.ok(existsSync(path.join(report.project, "assets", "research", "harbour.jpg")));
    const planned = calls.filter((call) => String(call.input).includes("assets/research/harbour.jpg"));
    assert.ok(planned.length, "the storyboard pass sees the staged photo in its asset manifest");
    assert.match(String(planned[0].input), /assets\/research\/harbour\.jpg — image, archive photo "Title harbour" from Wikimedia Commons.*Supports claim c001/);
    assert.ok(!calls.some((call) => String(call.input).includes("assets/research/nc")));
  } finally {
    await rm(assets, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});
