// The research stage's file contracts (docs/RESEARCH.md).
//
//   research/evidence.json        launchclip.evidence.v1        claim → sources → status
//   research/captures/<id>.json   launchclip.capture.v1         one on-screen source each (src/evidence/ renders them)
//   research/data/<id>.json       launchclip.research-data.v1   numbers lifted from a source's table, cited
//   research/assets.json          launchclip.research-assets.v1 licence-clear footage, images and portraits
//
// The ledger shares its version string with production/evidence.json (the
// evidence stage's item list) but not its shape: the ledger keys its version
// as `schema` and lives under research/, so the two never meet in one file.

export const LEDGER_SCHEMA = "launchclip.evidence.v1";
export const CAPTURE_SCHEMA = "launchclip.capture.v1";
export const DATA_SCHEMA = "launchclip.research-data.v1";
export const ASSETS_SCHEMA = "launchclip.research-assets.v1";

export const RESEARCH_PATHS = Object.freeze({
  dir: "research",
  ledger: "evidence.json",
  digest: "RESEARCH.md",
  captures: "captures",
  data: "data",
  assets: "assets.json",
  snapshots: "snapshots"
});

export const CLAIM_KINDS = Object.freeze(["number", "date", "quote", "entity", "statement"]);
export const CLAIM_STATUSES = Object.freeze(["verified", "contradicted", "unverified"]);
export const CAPTURE_KINDS = Object.freeze(["page", "post", "repo", "pr", "diff", "commit", "model-card", "chart", "article"]);
export const CAPTURE_ACTIONS = Object.freeze(["scroll", "zoom", "cursor", "select", "highlight", "focus-ring", "pin", "wait"]);

// Licences an asset may carry. Anything else is dropped at search time, so
// assets.json never holds a clip the video cannot show.
export const CLEAR_LICENCES = Object.freeze(["public-domain", "cc0", "cc-by", "cc-by-sa", "pexels", "pixabay", "nasa-media"]);

// Never a source of footage or stills, whatever the search returned.
export const BLOCKED_MEDIA_HOSTS = Object.freeze(["youtube.com", "youtu.be", "youtube-nocookie.com", "netflix.com", "imdb.com", "tiktok.com", "instagram.com", "facebook.com", "x.com", "twitter.com", "vimeo.com"]);

export function validateLedger(ledger) {
  const errors = [];
  if (ledger?.schema !== LEDGER_SCHEMA) errors.push(`schema must be ${LEDGER_SCHEMA}`);
  if (!Array.isArray(ledger?.claims)) return [...errors, "claims must be an array"];
  const ids = new Set();
  for (const claim of ledger.claims) {
    const at = `claim ${claim?.id ?? "?"}`;
    if (!claim?.id || ids.has(claim.id)) errors.push(`${at}: id missing or repeated`);
    ids.add(claim?.id);
    if (!claim?.text) errors.push(`${at}: text missing`);
    if (!CLAIM_KINDS.includes(claim?.kind)) errors.push(`${at}: kind must be one of ${CLAIM_KINDS.join(", ")}`);
    if (!CLAIM_STATUSES.includes(claim?.status)) errors.push(`${at}: status must be one of ${CLAIM_STATUSES.join(", ")}`);
    if (!Array.isArray(claim?.sources)) { errors.push(`${at}: sources must be an array`); continue; }
    for (const source of claim.sources) {
      if (!/^https?:\/\//.test(source?.url ?? "")) errors.push(`${at}: source url must be http(s)`);
      if (typeof source?.primary !== "boolean") errors.push(`${at}: source primary must be boolean`);
      if (!(source?.confidence >= 0 && source?.confidence <= 1)) errors.push(`${at}: source confidence must be 0..1`);
      if (!source?.fetched_at) errors.push(`${at}: source fetched_at missing`);
      if (source?.sha256 != null && !/^[a-f0-9]{64}$/.test(source.sha256)) errors.push(`${at}: source sha256 must be hex`);
    }
    // Honesty: a verified claim has a supporting quote from a fetched source.
    if (claim?.status === "verified" && !claim.sources.some((source) => source.supports === true && source.quote?.text)) errors.push(`${at}: verified without a supporting quote`);
    if (claim?.status === "unverified" && !claim?.flag) errors.push(`${at}: unverified claims carry a flag for the script`);
  }
  return errors;
}

export function validateCapture(request) {
  const errors = [];
  const at = `capture ${request?.id ?? "?"}`;
  if (request?.schema !== CAPTURE_SCHEMA) errors.push(`${at}: schema must be ${CAPTURE_SCHEMA}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(request?.id ?? "")) errors.push(`${at}: id must be kebab-case`);
  if (!/^https?:\/\//.test(request?.url ?? "")) errors.push(`${at}: url must be http(s)`);
  if (!CAPTURE_KINDS.includes(request?.kind)) errors.push(`${at}: kind must be one of ${CAPTURE_KINDS.join(", ")}`);
  if (!(request?.viewport?.width > 0 && request?.viewport?.height > 0)) errors.push(`${at}: viewport needs width and height`);
  if (!["dark", "light"].includes(request?.theme)) errors.push(`${at}: theme must be dark or light`);
  if (!Array.isArray(request?.beats) || !request.beats.length) errors.push(`${at}: beats must be a non-empty array`);
  for (const beat of request?.beats ?? []) {
    if (!CAPTURE_ACTIONS.includes(beat?.action)) errors.push(`${at}: beat action must be one of ${CAPTURE_ACTIONS.join(", ")}`);
    if (!(beat?.at >= 0) || !(beat?.dur > 0)) errors.push(`${at}: beat needs at >= 0 and dur > 0`);
    const target = beat?.target;
    if (target != null && typeof target !== "string" && typeof target?.text !== "string") errors.push(`${at}: beat target must be a selector or {text}`);
  }
  if (request?.out !== `assets/evidence/${request?.id}.mp4`) errors.push(`${at}: out must be assets/evidence/<id>.mp4`);
  if (!request?.provenance?.source_title || !request?.provenance?.fetched_at) errors.push(`${at}: provenance needs source_title and fetched_at`);
  return errors;
}

export function validateAssets(manifest) {
  const errors = [];
  if (manifest?.schema !== ASSETS_SCHEMA) errors.push(`schema must be ${ASSETS_SCHEMA}`);
  for (const asset of manifest?.assets ?? []) {
    const at = `asset ${asset?.id ?? "?"}`;
    if (!CLEAR_LICENCES.includes(asset?.licence?.id)) errors.push(`${at}: licence ${asset?.licence?.id} is not licence-clear`);
    if (!asset?.attribution) errors.push(`${at}: attribution missing`);
    if (!asset?.author) errors.push(`${at}: author missing`);
    if (!/^https?:\/\//.test(asset?.source_url ?? "")) errors.push(`${at}: source_url must be http(s)`);
    if (isBlockedMediaUrl(asset?.source_url) || isBlockedMediaUrl(asset?.media_url)) errors.push(`${at}: blocked host`);
  }
  return errors;
}

export function isBlockedMediaUrl(url) {
  if (!url) return false;
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return true; }
  return BLOCKED_MEDIA_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}
