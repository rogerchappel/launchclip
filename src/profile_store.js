// Cadence profile lookup: the shipped profiles under kit/profiles/, or a
// profile file a user or style points at (docs/VIDEO_QUALITY_RFC.md §5).
//
//   shippedProfiles()                 → [profile] (validated, sorted by id)
//   resolveProfile(nameOrPath)        → {profile, source, file}
//   profileForStory(story, options)   → {profile, reason, source}
//
// kit/core/profiles.mjs owns the schema, validation and selection.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aspectOf, selectProfile, validateProfile } from "@launchclip/core/profiles.mjs";

export const PROFILE_DIR = fileURLToPath(new URL("../kit/profiles/", import.meta.url));

let cache = null;

/** Every shipped profile, validated (a broken shipped profile throws). */
export function shippedProfiles({ dir = PROFILE_DIR, fresh = false } = {}) {
  if (dir === PROFILE_DIR && cache && !fresh) return cache;
  const profiles = readdirSync(dir).filter((file) => file.endsWith(".json")).sort().map((file) => {
    const profile = readProfileFile(path.join(dir, file));
    if (`${profile.id}.json` !== file) throw new Error(`${file}: a shipped profile's file is named after its id (${profile.id}.json)`);
    return profile;
  });
  if (dir === PROFILE_DIR) cache = profiles;
  return profiles;
}

/** Read and validate one profile file. */
export function readProfileFile(file) {
  let profile;
  try { profile = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Cannot read cadence profile ${file}: ${error.message}`); }
  const check = validateProfile(profile);
  if (!check.ok) throw new Error(`${file} is not a valid cadence profile:\n- ${check.errors.join("\n- ")}`);
  return profile;
}

/** A shipped profile by id, or a profile file by path. */
export function resolveProfile(value, { projectDir = process.cwd() } = {}) {
  const name = String(value ?? "").trim();
  if (!name) throw new Error("profile needs a name or a path");
  const shipped = shippedProfiles().find((profile) => profile.id === name);
  if (shipped) return { profile: shipped, source: "shipped", file: path.join(PROFILE_DIR, `${name}.json`) };
  const file = path.resolve(projectDir, name);
  if (existsSync(file)) return { profile: readProfileFile(file), source: "file", file };
  throw new Error(`Unknown cadence profile: ${name}. Shipped profiles: ${shippedProfiles().map((profile) => profile.id).join(", ")}`);
}

/**
 * The profile a story plans and is checked against: an explicit one
 * (options.profile, the direction map's, then the style's `profile`), else
 * the shipped profile that fits the story's lane, aspect, duration and
 * platform. A story with a cast is a character story; one whose
 * product-demo scenes fill at least 40% of the runtime is demo-led.
 */
export function profileForStory(story, { profile = null, direction = null, style = null, projectDir = process.cwd() } = {}) {
  const explicit = profile ?? direction?.profile ?? styleProfile(style) ?? story?.profile ?? null;
  if (explicit && typeof explicit === "object") {
    const check = validateProfile(explicit);
    if (!check.ok) throw new Error(`the style's cadence profile is invalid:\n- ${check.errors.join("\n- ")}`);
    return { profile: explicit, reason: `the style's own profile ${explicit.id}`, source: "style" };
  }
  if (explicit) {
    const resolved = resolveProfile(explicit, { projectDir });
    return { profile: resolved.profile, reason: `named profile ${resolved.profile.id}`, source: resolved.source };
  }
  const format = story?.format ?? {};
  const duration = Number(story?.resolved?.duration ?? format.duration);
  const picked = selectProfile(shippedProfiles(), {
    lane: story?.lane,
    aspect: aspectOf(format),
    duration,
    platform: format.platform ?? null,
    cast: Array.isArray(story?.cast) ? story.cast.length > 0 : Boolean(story?.cast),
    demo: demoLed(story, duration)
  });
  return { ...picked, source: picked.profile ? "shipped" : null };
}

/**
 * kit/profiles/PROVENANCE.md: where each profile's numbers come from (RFC
 * §5.4), the way THIRD_PARTY_NOTICES.md lists bundled dependencies.
 */
export function provenanceMarkdown(profiles = shippedProfiles()) {
  const lines = [
    "# Cadence profile provenance",
    "",
    "<!-- Generated from kit/profiles/*.json by launchclip profile measure (src/profile_store.js provenanceMarkdown). test/profiles.test.js fails when it drifts. -->",
    "",
    "Each shipped cadence profile is a set of ranges over measurements of reference videos. Only measurements are stored, never a reference's frames, audio or text. References are videos we have the right to analyse: our own, licensed, or public videos analysed for statistics only.",
    "",
    "A seed profile has no references yet: its ranges were set by hand, conservatively, and `launchclip profile measure <folder> --replace <id> --rights …` replaces it with a measured one.",
    ""
  ];
  for (const profile of profiles) {
    lines.push(`## ${profile.id}`, "", `${profile.title ?? profile.id}: ${profile.format}, ${profile.duration_seconds[0]}–${profile.duration_seconds[1]} s${profile.match?.aspects ? `, ${profile.match.aspects.join(" or ")}` : ""}.`, "");
    lines.push(`- Provenance: ${profile.provenance.kind}${profile.provenance.measured_at ? ` (measured ${profile.provenance.measured_at})` : ""}`);
    lines.push(`- References: ${profile.references}`);
    if (profile.provenance.note) lines.push(`- Note: ${profile.provenance.note}`);
    if (profile.provenance.sources.length) {
      lines.push("", "| Source | Rights | Duration | SHA-256 |", "| --- | --- | --- | --- |");
      for (const source of profile.provenance.sources) lines.push(`| ${source.title ?? source.id} | ${source.rights} | ${source.duration_seconds ?? "—"} s | ${source.sha256 ? `\`${source.sha256.slice(0, 12)}\`` : "—"} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// style-v3 adds `profile` (a shipped id, a path, or an inline measured profile).
function styleProfile(style) {
  const value = style?.profile ?? style?.pack?.profile ?? null;
  return value ?? null;
}

function demoLed(story, duration) {
  if (!(duration > 0)) return false;
  let covered = 0;
  for (const scene of Array.isArray(story?.scenes) ? story.scenes : []) {
    if (scene?.module !== "product-demo") continue;
    const start = Number(scene.start), end = Number(scene.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) covered += end - start;
  }
  return covered / duration >= 0.4;
}
