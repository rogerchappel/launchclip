// The approval pack (docs/APPROVAL_RFC.md §4): finished posts gathered into one
// folder with every platform's files and captions, APPROVAL.json and one page.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isCarousel } from "@launchclip/core/carousel.mjs";
import { run as exportCarousel, postCaption } from "../carousel/export.js";
import { approvalPage } from "./page.js";

export const APPROVAL_VERSION = "launchclip.approval.v1";
export const DECISIONS = Object.freeze(["pending", "approved", "changes", "dropped"]);
const MEDIA = /\.(png|jpe?g|mp4|pdf)$/i;

const readJson = async (file) => (existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null);

/** The pack in a folder, or null when there is none yet. A file that does not parse throws: it is never replaced silently. */
export async function loadPack(dir) {
  const pack = await readJson(path.join(dir, "APPROVAL.json"));
  if (pack && pack.schema !== APPROVAL_VERSION) throw new Error(`${path.join(dir, "APPROVAL.json")} is not a ${APPROVAL_VERSION} pack`);
  return pack;
}

export async function savePack(dir, pack) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "APPROVAL.json"), `${JSON.stringify(pack, null, 2)}\n`);
  await writeFile(path.join(dir, "index.html"), approvalPage(pack));
}

export const tally = (pack) => Object.fromEntries(DECISIONS.map((decision) => [decision, pack.posts.filter((post) => post.decision === decision).length]));

/**
 * launchclip approval build <project>… --out <dir>: add each project to the
 * pack. A post already there keeps its decision unless its files or captions changed.
 */
export async function buildPack(projects, flags = {}) {
  if (!projects.length) throw new Error("launchclip approval build needs at least one project folder");
  if (typeof flags.out !== "string") throw new Error("launchclip approval build needs --out <dir>");
  const out = path.resolve(flags.out);
  const pack = (await loadPack(out)) ?? { schema: APPROVAL_VERSION, title: "Posts for approval", created: new Date().toISOString(), posts: [] };
  if (typeof flags.title === "string") pack.title = flags.title;
  for (const target of projects) {
    const project = path.resolve(target);
    const id = path.basename(project);
    const found = await gather(project, id, flags);
    const old = pack.posts.find((post) => post.id === id);
    const n = old?.n ?? Math.max(0, ...pack.posts.map((post) => post.n)) + 1;
    const folder = `posts/${String(n).padStart(2, "0")}-${id}`;
    await rm(path.join(out, folder), { recursive: true, force: true });
    const hash = createHash("sha1");
    for (const [name, from] of Object.entries(found.copy).sort()) {
      await mkdir(path.dirname(path.join(out, folder, name)), { recursive: true });
      await cp(from, path.join(out, folder, name));
      hash.update(`${name}:${(await stat(from)).size}\n`);
    }
    const fingerprint = hash.update(JSON.stringify(found.destinations)).digest("hex");
    const kept = old?.fingerprint === fingerprint ? old : { decision: "pending", note: "", decided_by: null, slack: null };
    const post = { id, n, title: found.title, kind: found.kind, slides: found.slides, day: typeof flags.day === "string" ? flags.day : old?.day ?? null, folder, destinations: found.destinations, checks: found.checks, fingerprint, decision: kept.decision, note: kept.note, decided_by: kept.decided_by, slack: kept.slack };
    if (old) pack.posts[pack.posts.indexOf(old)] = post;
    else pack.posts.push(post);
  }
  await savePack(out, pack);
  return { dir: out, pack };
}

// One project's files and captions: a carousel or single image from its export, else a finished video.
async function gather(project, id, flags) {
  const story = await readJson(path.join(project, "storyboard.json"));
  if (!story) throw new Error(`${id}: no storyboard.json in ${project}`);
  const captions = (await readJson(path.join(project, "captions.json"))) ?? {};
  const copy = {};
  const destinations = {};
  if (!isCarousel(story)) {
    const video = path.join(project, "renders", "final.mp4");
    if (!existsSync(video)) throw new Error(`${id}: no renders/final.mp4; finish the video first`);
    copy["video.mp4"] = video;
    const fallback = (await readJson(path.join(project, "publish.json")))?.description;
    const names = Object.keys(captions).length ? Object.keys(captions) : ["video"];
    for (const name of names) destinations[name] = { files: ["video.mp4"], caption: String(captions[name] ?? (typeof fallback === "string" ? fallback : "")) };
    return { title: story.title ?? id, kind: "video", slides: null, copy, destinations, checks: { ok: null, warnings: [] } };
  }
  const report = await exportCarousel(project, { dest: flags.dest });
  const warnings = [];
  for (const [name, dest] of Object.entries(report.destinations)) {
    if (dest.status !== "exported") continue;
    const files = dest.files.filter((file) => MEDIA.test(file));
    for (const file of files) copy[`${name}/${file}`] = path.join(dest.dir, file);
    destinations[name] = { files: files.map((file) => `${name}/${file}`), caption: String(captions[name] ?? postCaption(story, name).plain) };
    warnings.push(...dest.warnings.map((warning) => `${name}: ${warning}`));
  }
  if (!Object.keys(destinations).length) throw new Error(`${id}: nothing is rendered; run launchclip carousel render ${project} first`);
  return { title: story.title ?? id, kind: report.slides.length === 1 ? "image" : "carousel", slides: report.slides.length, copy, destinations, checks: { ok: report.check ? report.check.status === "passed" : null, warnings } };
}

/** Decisions from the page's "Copy decisions" (or any [{id, decision, note?, by?}]) into the pack. */
export function applyDecisions(pack, list) {
  if (!Array.isArray(list)) throw new Error("decisions must be a list of {id, decision, note}");
  for (const item of list) {
    const post = pack.posts.find((entry) => entry.id === item?.id);
    if (!post) throw new Error(`no post ${JSON.stringify(item?.id)} in this pack`);
    if (!DECISIONS.includes(item.decision)) throw new Error(`${item.id}: decision must be one of ${DECISIONS.join(", ")}`);
    Object.assign(post, { decision: item.decision, note: String(item.note ?? ""), decided_by: item.by ?? null });
  }
  return pack;
}
