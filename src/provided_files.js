// Files the asset provider answered with, recognised when they turn up in
// the assets folder of a later run.
//
// An app's provider may answer a shot request with a file it wrote into the
// same folder it passes as --assets. The first run copies that file to
// assets/shots/ and never looks at the folder again; a second run of the
// project (a rerun, or --replan after a failed storyboard) inventories the
// folder and finds the files there. They are not the user's own media: each
// was fetched for one request of an earlier plan. Treated as handed-in files
// they were described by the model one by one, changed the brief the script
// was written from (so the writing ran again) and were offered to the planner
// as footage the user supplied.
//
//   recordProvided(project, {file, src, request, shot})  one answer, by content hash
//   readProvided(project)        → Map sha256 → record
//   providedNotes(record)        → footage notes from the request and the provider's notes
//   markProvided(inventory, {project, root}) → the paths recognised
//
// The record is <project>/.launchclip/provided-files.json: {schema_version,
// files: {<sha256>: {src, kind, shows, line?, notes?}}}. A file is matched by
// its bytes, so a provider that writes the same clip under another name, or
// an app that moves its assets folder, is still recognised.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeFileAtomic } from "./atomic_write.js";
import { normalizeNotes } from "./inventory_notes.js";

export const PROVIDED_FILE = ".launchclip/provided-files.json";
export const PROVIDED_VERSION = "launchclip.provided-files.v1";

const queues = new Map();

export function fileSha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

/** The record as a Map sha256 → {src, kind, shows, line?, notes?}; empty when the project has none. */
export async function readProvided(project) {
  if (!project) return new Map();
  try {
    const document = JSON.parse(await readFile(path.join(project, PROVIDED_FILE), "utf8"));
    return new Map(Object.entries(document?.files && typeof document.files === "object" ? document.files : {}));
  } catch {
    return new Map();
  }
}

/**
 * Record one answer: `file` (the copy under the project, or the provider's
 * own) answered `request` ({shows, line?}) with `shot` ({kind?, notes?}).
 * Answers arrive several at a time, so the writes of one project queue.
 */
export function recordProvided(project, { file, src, request, shot = null }) {
  const key = path.resolve(project);
  const next = (queues.get(key) ?? Promise.resolve()).then(async () => {
    const sha = await fileSha256(file);
    const files = Object.fromEntries(await readProvided(project));
    files[sha] = {
      src,
      ...(shot?.kind ? { kind: shot.kind } : {}),
      shows: String(request?.shows ?? "").trim().slice(0, 300),
      ...(request?.line ? { line: String(request.line).slice(0, 300) } : {}),
      ...(shot?.notes ? { notes: shot.notes } : {})
    };
    await mkdir(path.join(project, path.dirname(PROVIDED_FILE)), { recursive: true });
    await writeFileAtomic(path.join(project, PROVIDED_FILE), `${JSON.stringify({ schema_version: PROVIDED_VERSION, files }, null, 2)}\n`);
  });
  // A failed write costs the record, never the shot.
  const settled = next.catch(() => {});
  queues.set(key, settled);
  return settled;
}

/**
 * Footage notes for a recorded file: what the provider said it shows, with
 * the request it answered; always b-roll, so a clip with speech in it is
 * never taken for the recording the video is cut from.
 */
export function providedNotes(record) {
  const asked = String(record?.shows ?? "").trim();
  const own = record?.notes && typeof record.notes === "object" ? record.notes : {};
  const said = typeof own.description === "string" ? own.description.trim().replace(/[.\s]+$/, "") : "";
  const fetched = asked ? `Fetched by the asset provider for "${asked}"` : "Fetched by the asset provider";
  const description = said ? `${said}. ${fetched}.` : `${fetched}.`;
  return normalizeNotes({ ...own, description, role: own.role ?? "b-roll" }, "provided notes").notes ?? { description };
}

/**
 * Mark the inventory entries the provider fetched: entry.provided = {src,
 * shows} and entry.notes from the record, under the caller's own notes. Only
 * images and videos without a description of their own are hashed, and
 * nothing is when the project has no record. → the paths marked.
 */
export async function markProvided(inventory, { project, root = inventory?.dir ?? null, hash = fileSha256 } = {}) {
  const records = await readProvided(project);
  const marked = [];
  if (!records.size || !root) return marked;
  for (const entry of inventory?.entries ?? []) {
    if (entry?.kind !== "image" && entry?.kind !== "video") continue;
    let sha = null;
    try { sha = await hash(path.join(root, entry.path)); } catch { continue; }
    const record = records.get(sha);
    if (!record) { delete entry.provided; continue; }
    entry.notes = { ...providedNotes(record), ...(entry.notes ?? {}) };
    if (entry.kind !== "video") delete entry.notes.windows;
    entry.provided = { src: record.src, shows: record.shows };
    marked.push(entry.path);
  }
  return marked;
}
