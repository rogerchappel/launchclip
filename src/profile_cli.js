// launchclip profile list | show <id|path> | measure <folder>
// (docs/VIDEO_QUALITY_RFC.md §5 and §12).
//
//   profile list                         the shipped cadence profiles
//   profile show <id|path>               one profile, validated
//   profile measure <folder> --rights own|licensed|public-statistics
//       (--id <new-id> | --replace <shipped-id>) [--out file] [--title "…"] [--fps 1]
//       measure a folder of references into a profile. --replace keeps the
//       shipped profile's id, format and match, writes over its JSON in
//       kit/profiles/ and refreshes kit/profiles/PROVENANCE.md.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROFILE_MEASURES, validateProfile } from "../kit/core/profiles.mjs";
import { measureProfile } from "./cadence_measures.js";
import { PROFILE_DIR, provenanceMarkdown, resolveProfile, shippedProfiles } from "./profile_store.js";

export const PROFILE_ACTIONS = Object.freeze(["list", "show", "measure"]);

export async function runProfileCommand(action, target, flags = {}, adapters = {}) {
  if (!PROFILE_ACTIONS.includes(action)) throw new Error(`Unknown profile action: ${action ?? "(none)"}; use ${PROFILE_ACTIONS.join(", ")}`);
  if (action === "list") {
    return {
      stage: "profile",
      action,
      profiles: shippedProfiles().map((profile) => ({
        id: profile.id,
        title: profile.title ?? profile.id,
        format: profile.format,
        lanes: profile.match?.lanes ?? null,
        aspects: profile.match?.aspects ?? null,
        platforms: profile.match?.platforms ?? null,
        duration_seconds: profile.duration_seconds,
        provenance: profile.provenance.kind,
        references: profile.references
      }))
    };
  }
  if (action === "show") {
    if (!target) throw new Error("profile show needs a profile id or a profile file");
    const { profile, source, file } = resolveProfile(target);
    const check = validateProfile(profile);
    return { stage: "profile", action, source, file, profile, warnings: check.warnings };
  }
  if (!target) throw new Error("profile measure needs a folder of reference videos");
  const base = flags.replace ? resolveProfile(String(flags.replace)).profile : null;
  if (flags.replace && flags.id && String(flags.id) !== base.id) throw new Error("--replace keeps the shipped profile's id; drop --id");
  const { profile, references, warnings } = await measureProfile(target, {
    id: flags.id ? String(flags.id) : undefined,
    base,
    rights: flags.rights ? String(flags.rights) : undefined,
    title: flags.title ? String(flags.title) : undefined,
    format: flags.format ? String(flags.format) : undefined,
    ...(flags.fps ? { fps: Number(flags.fps) } : {}),
    now: adapters.now
  }, adapters.measure ?? {});
  const out = flags.out ? path.resolve(String(flags.out)) : base ? path.join(adapters.profileDir ?? PROFILE_DIR, `${profile.id}.json`) : path.resolve(String(target), `${profile.id}.cadence-profile.json`);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(profile, null, 2)}\n`);
  let provenance = null;
  if (base && !flags.out) {
    const dir = adapters.profileDir ?? PROFILE_DIR;
    provenance = path.join(dir, "PROVENANCE.md");
    await writeFile(provenance, provenanceMarkdown(shippedProfiles({ dir, fresh: true })));
  }
  return {
    stage: "profile",
    action,
    status: "measured",
    id: profile.id,
    out,
    provenance,
    references: references.length,
    measures: Object.keys(profile.measures).filter((name) => PROFILE_MEASURES[name]),
    per_reference: references,
    warnings
  };
}
