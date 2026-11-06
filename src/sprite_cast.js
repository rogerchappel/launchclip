// Sprite casts: the illustrated characters `sprite-scene` stages
// (kit/core/catalog-sprites.mjs). A cast file names the characters once;
// `launchclip cast sprites <project>` draws each one with an image model, a
// picture per pose plus a mouth-open ("talk") and an eyes-closed ("blink")
// version of each, and cuts them out, so every scene shows the same person.
//
// Cast file: <project>/cast.sprites.json
//   {style?: "how every character is drawn",
//    characters: [{id, name, role?, design: "who they look like", voice?,
//      color?, poses?: ["idle", "shocked", ...], talk?: true, blink?: true,
//      refs?: ["assets/…" reference images]}]}
//
// Output: assets/cast/<id>/<pose>.png, <pose>-talk.png, <pose>-blink.png
// (transparent PNGs, all the same size and framing) and
// assets/cast/<id>/character.json (what was made, the prompts and the cost).
//
// Consistency: each character's first picture (its first pose, at rest) is
// the anchor; every other picture of it is an edit of that anchor ("the same
// character, now …"), and a talk or blink picture is an edit of its own pose
// with only the mouth or the eyes changed, so frames line up for a swap.
// Cut-out: the model draws on flat pure green, which is keyed out here
// (chromaKey), with green spill pulled from the edges.
//
// Generation goes through an adapter: generate({prompt, references, size})
// → {buffer} | {file}. openaiImageAdapter() calls the OpenAI Images API
// (OPENAI_API_KEY); a host app passes its own (its AI image provider).

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { decodePng } from "./visual_snapshot.js";

export const SPRITE_CAST_FILE = "cast.sprites.json";
export const SPRITE_CAST_DIR = "assets/cast";
export const SPRITE_DEFAULT_STYLE = "a flat 2D cartoon illustration with thick clean dark outlines, simple rounded shapes, soft cel shading and a warm limited palette; friendly, readable at phone size";
export const SPRITE_SIZE = "1024x1536";
// An estimate per picture at SPRITE_SIZE, medium quality (the OpenAI Images
// API's published price band at the time of writing); hosts report their own.
export const SPRITE_IMAGE_USD = 0.063;
const GREEN = "a perfectly flat, pure bright green (#00FF00) background with no gradient, floor, shadow or other objects";
const POSE = /^[a-z][a-z0-9-]{0,31}$/;
const ID = /^[a-z][a-z0-9_-]{0,39}$/;

/** A cast file's characters, checked. Throws with every problem at once. */
export function normalizeSpriteCast(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object") throw new Error(`${SPRITE_CAST_FILE} must be an object with characters`);
  const style = raw.style === undefined ? SPRITE_DEFAULT_STYLE : String(raw.style).trim();
  const list = Array.isArray(raw.characters) ? raw.characters : [];
  if (!list.length || list.length > 8) errors.push("characters must list 1–8 characters");
  const seen = new Set();
  const characters = list.map((entry, i) => {
    const at = `characters[${i}]`;
    if (!entry || typeof entry !== "object") { errors.push(`${at} must be an object`); return null; }
    if (typeof entry.id !== "string" || !ID.test(entry.id)) errors.push(`${at}.id must be a lowercase id`);
    if (seen.has(entry.id)) errors.push(`${at}.id ${entry.id} is used twice`);
    seen.add(entry.id);
    if (typeof entry.design !== "string" || entry.design.trim().length < 12) errors.push(`${at}.design must describe how the character looks (at least a sentence)`);
    const poses = entry.poses === undefined ? ["idle"] : entry.poses;
    if (!Array.isArray(poses) || !poses.length || poses.length > 8 || poses.some((pose) => typeof pose !== "string" || !POSE.test(pose))) errors.push(`${at}.poses must be 1–8 pose names (lowercase, e.g. idle, shocked, pointing)`);
    const refs = entry.refs === undefined ? [] : entry.refs;
    if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string" || !ref.startsWith("assets/"))) errors.push(`${at}.refs must be assets/ image paths`);
    return {
      id: entry.id, name: entry.name ? String(entry.name) : entry.id, role: entry.role ? String(entry.role) : null,
      design: String(entry.design ?? "").trim(), voice: entry.voice ? String(entry.voice) : null, color: entry.color ?? null,
      poses: Array.isArray(poses) ? [...new Set(poses)] : ["idle"], talk: entry.talk !== false, blink: entry.blink !== false, refs: Array.isArray(refs) ? refs : []
    };
  });
  if (errors.length) throw new Error(`${SPRITE_CAST_FILE}: ${errors.join("; ")}`);
  return { style, characters };
}

/** A pose name read as an instruction: "pointing-left" → "pointing left". */
function poseWords(pose) {
  return pose === "idle" ? "standing relaxed, arms at its sides, facing the viewer at a slight three-quarter angle" : `${pose.replace(/-/g, " ")}, full body`;
}

/**
 * Every picture a cast needs, in the order to make them (each character's
 * anchor first): [{id, pose, face: rest|talk|blink, file, prompt, references, edit}].
 * `references` are project paths; `edit` is the picture the request edits (null for an anchor).
 */
export function spriteRequests(cast) {
  const out = [];
  for (const character of cast.characters) {
    const dir = `${SPRITE_CAST_DIR}/${character.id}`;
    const anchorPose = character.poses[0];
    const anchor = `${dir}/${anchorPose}.png`;
    const who = `${character.name}${character.role ? `, ${character.role}` : ""}: ${character.design}`;
    for (const pose of character.poses) {
      const file = `${dir}/${pose}.png`;
      const isAnchor = pose === anchorPose;
      out.push({
        id: character.id, pose, face: "rest", file, edit: isAnchor ? null : anchor, references: isAnchor ? character.refs : [anchor, ...character.refs],
        prompt: isAnchor
          ? `Character design, full body, head to toe, centred, filling most of the frame height. ${who}. Pose: ${poseWords(pose)}. Mouth closed, eyes open. Drawn as ${cast.style}. On ${GREEN}. No text, no logos, no frame.`
          : `The same character as the reference image, identical design, proportions, clothes and colours, drawn the same way, same framing and size. New pose: ${poseWords(pose)}. Mouth closed, eyes open. On ${GREEN}. No text.`
      });
      const faces = [...(character.talk ? ["talk"] : []), ...(character.blink ? ["blink"] : [])];
      for (const face of faces) {
        out.push({
          id: character.id, pose, face, file: `${dir}/${pose}-${face}.png`, edit: file, references: [file],
          prompt: `Exactly the same image as the reference: same character, pose, framing, size, line work and colours, pixel for pixel wherever possible. The only change: ${face === "talk" ? "the mouth is open mid-word, as if speaking" : "both eyes are closed in a blink"}. Keep the ${GREEN}.`
        });
      }
    }
  }
  return out;
}

/** What making a cast costs, estimated: {images, usd}. */
export function spriteCastCost(cast, { perImage = SPRITE_IMAGE_USD } = {}) {
  const images = spriteRequests(cast).length;
  return { images, per_image_usd: perImage, usd: Math.round(images * perImage * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// Cut-out

/**
 * A PNG on flat green → the same PNG with the green transparent: pixels near
 * the key colour go clear, the soft band around the subject goes partly
 * clear, and green spill is pulled from what stays.
 */
export function chromaKey(buffer, { tolerance = 0.28, softness = 0.14 } = {}) {
  const image = decodePng(buffer);
  const { width, height, pixels } = image;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2], a = pixels[i * 4 + 3];
    // How green the pixel is: green above the larger of red and blue, 0–1.
    const greenness = Math.max(0, (g - Math.max(r, b)) / 255);
    let alpha = 1;
    if (greenness >= tolerance + softness) alpha = 0;
    else if (greenness > tolerance) alpha = 1 - (greenness - tolerance) / softness;
    // Spill: a kept pixel's green no higher than its brighter other channel.
    const gg = alpha > 0 ? Math.min(g, Math.max(r, b) + 8) : g;
    out[i * 4] = r; out[i * 4 + 1] = gg; out[i * 4 + 2] = b; out[i * 4 + 3] = Math.round(a * alpha);
  }
  return encodePng(width, height, out);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(buffer) { let c = 0xffffffff; for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** RGBA pixels → a PNG buffer (8-bit, colour type 6, no filtering). */
export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------
// Generation

/**
 * The OpenAI Images API as a generate() adapter: an anchor is a fresh
 * generation, every other picture an edit of its references.
 */
export function openaiImageAdapter({ apiKey = process.env.OPENAI_API_KEY, model = process.env.LAUNCHCLIP_SPRITE_MODEL || "gpt-image-1", quality = "medium", fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) throw new Error("cast sprites needs OPENAI_API_KEY (or a host's image adapter); run with --dry-run to see the plan and cost");
  return async ({ prompt, references = [], size = SPRITE_SIZE }) => {
    let response;
    if (!references.length) {
      response = await fetchImpl("https://api.openai.com/v1/images/generations", {
        method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, size, quality, n: 1 })
      });
    } else {
      const form = new FormData();
      form.append("model", model); form.append("prompt", prompt); form.append("size", size); form.append("quality", quality);
      for (const ref of references) form.append("image[]", new Blob([ref.buffer], { type: "image/png" }), path.basename(ref.path));
      response = await fetchImpl("https://api.openai.com/v1/images/edits", { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form });
    }
    if (!response.ok) throw new Error(`image model returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const json = await response.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("image model returned no picture");
    return { buffer: Buffer.from(b64, "base64"), usage: json.usage ?? null };
  };
}

/**
 * Make a project's sprite cast. options: {generate (adapter), dryRun, only
 * (character ids), force (redo pictures that exist), say}. Pictures that
 * already exist are kept unless force, so a run that stopped resumes.
 * → {status, cast, requests, made, kept, cost}
 */
export async function makeSpriteCast(project, { generate = null, dryRun = false, only = null, force = false, say = () => {} } = {}) {
  const castFile = path.join(project, SPRITE_CAST_FILE);
  if (!existsSync(castFile)) throw new Error(`${castFile} does not exist; write the cast there first (characters: [{id, name, design, poses}])`);
  const cast = normalizeSpriteCast(JSON.parse(await readFile(castFile, "utf8")));
  const wanted = only ? cast.characters.filter((character) => only.includes(character.id)) : cast.characters;
  const scoped = { ...cast, characters: wanted };
  const requests = spriteRequests(scoped);
  const cost = spriteCastCost(scoped);
  if (dryRun) return { stage: "cast", action: "sprites", status: "planned", cast: scoped, requests, made: [], kept: [], cost };
  const adapter = generate ?? openaiImageAdapter();
  const made = [], kept = [];
  for (const request of requests) {
    const target = path.join(project, request.file);
    if (!force && existsSync(target)) { kept.push(request.file); continue; }
    const references = [];
    for (const ref of request.references) {
      const file = path.join(project, ref);
      if (!existsSync(file)) throw new Error(`${request.file} needs ${ref}, which was not made`);
      references.push({ path: ref, buffer: await readFile(file) });
    }
    say(`cast: drawing ${request.id} ${request.pose}${request.face === "rest" ? "" : ` (${request.face})`}`);
    const result = await adapter({ prompt: request.prompt, references, size: SPRITE_SIZE });
    const raw = result.buffer ?? await readFile(result.file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, chromaKey(raw));
    made.push(request.file);
  }
  for (const character of wanted) {
    const dir = path.join(project, SPRITE_CAST_DIR, character.id);
    const prompts = requests.filter((request) => request.id === character.id).map(({ pose, face, file, prompt }) => ({ pose, face, file, prompt }));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "character.json"), `${JSON.stringify({ ...character, art: `${SPRITE_CAST_DIR}/${character.id}`, style: cast.style, pictures: prompts }, null, 2)}\n`);
  }
  return { stage: "cast", action: "sprites", status: "ready", cast: scoped, requests, made, kept, cost: { ...cost, images_made: made.length, usd_spent: Math.round(made.length * cost.per_image_usd * 1000) / 1000 } };
}

/**
 * The story-cast entries for a sprite cast (story.cast.characters): id, name
 * and voice, so a dialogue line's speaker resolves and `says: "auto"` finds
 * its words.
 */
export function storyCastEntries(cast) {
  return cast.characters.map((character) => ({ id: character.id, name: character.name, ...(character.voice ? { voice: character.voice } : {}) }));
}
