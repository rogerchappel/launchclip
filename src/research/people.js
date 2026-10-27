// People: each person the script names → name, role, affiliation and a
// licence-clear portrait from Wikimedia Commons (the Wikidata item's image),
// or no portrait. Never a photo scraped from a page. A Wikidata match is kept
// only when it is a human and either the only one by that name or tied to an
// organisation the script also names; otherwise the person stays, unmatched,
// with the role the script gives them.
import { commonsAsset } from "./media.js";
import { CLEAR_LICENCES } from "./schema.js";

const ROLE_PATTERN = /\b(?:CEO|CTO|CFO|COO|founder|co-founder|president|chair(?:man|woman)?|chief [a-z]+ officer|head of [A-Za-z ]+|director of [A-Za-z ]+|(?:lead|senior|principal|staff|research) (?:scientist|engineer|researcher)|researcher|scientist|engineer|professor)\b(?:\s+(?:of|at)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3}))?/i;

/** person entities + claims → people[] and portrait assets[] */
export async function findPeople(http, entities, claims, options = {}) {
  const orgs = entities.filter((entity) => entity.kind === "org" || entity.kind === "name").map((entity) => entity.name);
  const people = [];
  const portraits = [];
  for (const person of entities.filter((entity) => entity.kind === "person").slice(0, Number(options.maxPeople ?? 8))) {
    const sentences = claims.filter((claim) => person.claims.includes(claim.id)).map((claim) => claim.text);
    const scriptRole = roleFromScript(person.name, sentences);
    const match = await wikidataPerson(http, person.name, [...orgs, scriptRole?.affiliation].filter(Boolean));
    const entry = {
      name: person.name,
      claims: person.claims,
      role: match?.role ?? scriptRole?.role ?? null,
      affiliation: match?.affiliation ?? scriptRole?.affiliation ?? null,
      role_in_script: scriptRole?.text ?? null,
      wikidata: match ? { id: match.id, url: `https://www.wikidata.org/wiki/${match.id}`, description: match.description, match: match.reason } : null,
      portrait: null
    };
    if (match?.image) {
      const portrait = await commonsPortrait(http, match.image, person.name, options.now);
      if (portrait) {
        portraits.push(portrait);
        entry.portrait = portrait.id;
      } else entry.portrait_note = "the Wikidata image is not licence-clear; no portrait";
    } else entry.portrait_note = match ? "no image on the Wikidata item; no portrait" : "no confident Wikidata match; no portrait";
    people.push(entry);
  }
  return { people, portraits };
}

/** "Liang Wenfeng, CEO of DeepSeek" → {role: "CEO", affiliation: "DeepSeek", text}. */
export function roleFromScript(name, sentences) {
  for (const sentence of sentences) {
    const at = sentence.indexOf(name);
    if (at < 0) continue;
    const near = sentence.slice(Math.max(0, at - 60), at + name.length + 80);
    const match = near.match(ROLE_PATTERN);
    if (match) {
      const text = match[0].replace(/[.,;:]+$/, "");
      return { role: text.replace(/\s+(?:of|at)\s+.*$/i, ""), affiliation: match[1]?.trim().replace(/[.,;:]+$/, "") ?? null, text };
    }
  }
  return null;
}

export async function wikidataPerson(http, name, orgs = []) {
  const search = await http.json(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=5&format=json&origin=*`);
  const ids = (search?.search ?? []).filter((hit) => normalise(hit.label) === normalise(name) || (hit.aliases ?? []).some((alias) => normalise(alias) === normalise(name))).map((hit) => hit.id);
  if (!ids.length) return null;
  const data = await http.json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids.join("|")}&props=claims|descriptions|labels&languages=en&format=json&origin=*`);
  const humans = ids.map((id) => data?.entities?.[id]).filter((entity) => itemIds(entity, "P31").includes("Q5"));
  if (!humans.length) return null;
  // Labels for occupations, employers and positions, in one call.
  const related = [...new Set(humans.flatMap((entity) => [...itemIds(entity, "P108"), ...itemIds(entity, "P39"), ...itemIds(entity, "P106")]))].slice(0, 45);
  const labels = related.length ? await http.json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${related.join("|")}&props=labels&languages=en&format=json&origin=*`) : null;
  const label = (id) => labels?.entities?.[id]?.labels?.en?.value ?? null;
  const orgWords = orgs.map(normalise).filter((word) => word.length >= 3);
  const scored = humans.map((entity) => {
    const employers = itemIds(entity, "P108").map(label).filter(Boolean);
    const description = entity.descriptions?.en?.value ?? "";
    const tied = orgWords.some((org) => [...employers, description].some((text) => normalise(text).includes(org)));
    return { entity, employers, description, tied };
  });
  const pick = scored.find((entry) => entry.tied) ?? (scored.length === 1 ? scored[0] : null);
  if (!pick) return null;
  const { entity, employers, description, tied } = pick;
  const positions = itemIds(entity, "P39").map(label).filter(Boolean);
  const occupations = itemIds(entity, "P106").map(label).filter(Boolean);
  const image = entity.claims?.P18?.[0]?.mainsnak?.datavalue?.value ?? null;
  return {
    id: entity.id,
    description,
    role: positions[0] ?? occupations[0] ?? null,
    affiliation: employers.at(-1) ?? null,
    image,
    reason: tied ? "employer or description names an organisation in the script" : "the only human with this name on Wikidata"
  };
}

export async function commonsPortrait(http, fileName, personName, now = new Date().toISOString()) {
  const data = await http.json(`https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${fileName}`)}&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1200&format=json&origin=*`);
  const page = Object.values(data?.query?.pages ?? {})[0];
  const asset = commonsAsset(page);
  if (!asset?.licence || !CLEAR_LICENCES.includes(asset.licence.id) || !asset.author) return null;
  return {
    id: `portrait-${normalise(personName).slice(0, 40)}`,
    role: "portrait",
    person: personName,
    provider: "wikimedia-commons",
    provider_name: "Wikimedia Commons",
    ...asset,
    attribution: `${personName}, photo by ${asset.author}, ${asset.licence.name}${asset.licence.url ? ` (${asset.licence.url})` : ""}, via Wikimedia Commons`,
    fetched_at: now
  };
}

function itemIds(entity, property) {
  return (entity?.claims?.[property] ?? []).map((claim) => claim.mainsnak?.datavalue?.value?.id).filter(Boolean);
}

function normalise(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
