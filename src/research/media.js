// Media sourcing (gap map C4): footage and stills for metaphor beats, from
// licence-clear sources only. Wikimedia Commons, NASA, the Internet Archive
// (public-domain items and the Prelinger collection), the Library of Congress
// (items with no known restrictions), and Pexels and Pixabay when their keys
// are set. Every asset carries its licence, author, attribution string and
// source page. Anything without a clear licence is dropped at search time,
// and no clip ever comes from YouTube, a streaming service or a film or TV
// release. Icons, logos, music and sound effects are not sourced here: the
// media-use skill's `resolve` owns those.
import { CLEAR_LICENCES, isBlockedMediaUrl } from "./schema.js";
import { decodeEntities } from "./http.js";

const STOP = new Set(["the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for", "with", "by", "is", "are", "was", "were", "be", "it", "its", "this", "that", "these", "those", "as", "from", "has", "have", "had", "just", "now", "than", "more", "most", "into", "over", "about", "what", "which", "who", "why", "how", "when", "where", "there", "here", "they", "them", "their", "we", "our", "you", "your", "can", "will", "would", "could", "should", "not", "no", "yes", "all", "every", "some", "one", "like", "think", "really", "very", "much", "many", "even", "still", "only", "also", "then", "so", "if", "because", "while", "after", "before", "imagine", "picture", "means", "matters", "thing", "things", "something", "everything", "nothing", "way", "lot", "kind"]);

/** Licence text from any provider → {id, name, url} when licence-clear, else null. */
export function normaliseLicence(text, url = null) {
  const value = `${text ?? ""} ${url ?? ""}`.toLowerCase();
  if (!value.trim()) return null;
  // Non-commercial and no-derivatives licences cannot go in an edited video that may earn money.
  if (/\bnc\b|non-?commercial|\bnd\b|no-?deriv|-nc|-nd|all rights reserved|fair use|copyrighted/.test(value)) return null;
  if (/cc0|cc-zero|zero\/1\.0/.test(value)) return { id: "cc0", name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" };
  if (/public ?domain|publicdomain|\bpd\b|pd-|no known restrictions/.test(value)) return { id: "public-domain", name: "Public domain", url: url ?? null };
  const version = value.match(/(?:by(?:-sa)?)[ /-]?(\d\.\d)/)?.[1] ?? null;
  if (/cc[ -]?by[ -]?sa|by-sa/.test(value)) return { id: "cc-by-sa", name: `CC BY-SA${version ? ` ${version}` : ""}`, url: url ?? (version ? `https://creativecommons.org/licenses/by-sa/${version}/` : null) };
  if (/cc[ -]?by\b|licenses\/by\//.test(value)) return { id: "cc-by", name: `CC BY${version ? ` ${version}` : ""}`, url: url ?? (version ? `https://creativecommons.org/licenses/by/${version}/` : null) };
  return null;
}

export function attributionFor(asset) {
  const title = asset.title ? `“${asset.title}”` : "Untitled";
  if (asset.provider === "pexels") return `${asset.type === "video" ? "Video" : "Photo"} by ${asset.author} on Pexels`;
  if (asset.provider === "pixabay") return `${asset.type === "video" ? "Video" : "Image"} by ${asset.author} from Pixabay`;
  if (asset.licence.id === "public-domain" || asset.licence.id === "cc0" || asset.licence.id === "nasa-media") return `${title}, ${asset.author}, ${asset.licence.name}, via ${asset.provider_name}`;
  return `${title} by ${asset.author}, ${asset.licence.name}${asset.licence.url ? ` (${asset.licence.url})` : ""}, via ${asset.provider_name}`;
}

/**
 * Queries for metaphor beats: explicit ones (--media, or the agent's list)
 * first, else the concrete words of script sentences that carry no claim.
 */
export function metaphorQueries(sentences, claims, options = {}) {
  if (options.queries?.length) return options.queries.map((query) => ({ query: String(query), beat: null }));
  const claimed = new Set(claims.map((claim) => claim.text));
  const out = [];
  for (const { text } of sentences) {
    if (claimed.has(text) || /\?$/.test(text)) continue;
    const words = (text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((word) => !STOP.has(word));
    const picked = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 2);
    if (picked.length) out.push({ query: picked.join(" "), beat: text });
    if (out.length >= Number(options.max ?? 6)) break;
  }
  return out;
}

/** Each query against every provider → licence-clear assets, a few per query. */
export async function findMedia(http, queries, options = {}) {
  const env = options.env ?? process.env;
  const perQuery = Number(options.perQuery ?? 3);
  const providers = mediaProviders(env, options.providers);
  const assets = [];
  const rejected = [];
  for (const { query, beat } of queries) {
    const found = [];
    for (const provider of providers) {
      let results = [];
      try { results = await provider.search(http, query); } catch { results = []; }
      for (const result of results) {
        const asset = { ...result, provider: provider.id, provider_name: provider.name, query, beat };
        const reason = rejectReason(asset);
        if (reason) { rejected.push({ provider: provider.id, source_url: asset.source_url, reason }); continue; }
        found.push(asset);
      }
    }
    // Footage first for a motion beat, then providers interleaved so one archive does not fill the list.
    const ordered = interleave(found, (asset) => asset.provider).sort((a, b) => Number(b.type === "video") - Number(a.type === "video"));
    for (const asset of ordered.slice(0, perQuery)) {
      const id = `${asset.provider}-${slug(asset.title ?? asset.source_url)}`.slice(0, 64);
      assets.push({ id: uniqueId(id, assets), ...asset, attribution: attributionFor(asset), fetched_at: options.now ?? new Date().toISOString() });
    }
  }
  return { assets, rejected, providers: providers.map((provider) => provider.id) };
}

export function rejectReason(asset) {
  if (isBlockedMediaUrl(asset.source_url) || isBlockedMediaUrl(asset.media_url)) return "blocked host";
  if (!asset.licence || !CLEAR_LICENCES.includes(asset.licence.id)) return "licence not clear";
  if (!asset.author) return "no author or credit line";
  if (!/^https?:\/\//.test(asset.source_url ?? "")) return "no source page";
  return null;
}

// ---------------------------------------------------------------------------
// Providers

export function mediaProviders(env = process.env, only = null) {
  const all = [commons(), nasa(), internetArchive(), libraryOfCongress(), ...(env.PEXELS_API_KEY ? [pexels(env.PEXELS_API_KEY)] : []), ...(env.PIXABAY_API_KEY ? [pixabay(env.PIXABAY_API_KEY)] : [])];
  return only ? all.filter((provider) => only.includes(provider.id)) : all;
}

export function commons() {
  return {
    id: "wikimedia-commons",
    name: "Wikimedia Commons",
    async search(http, query) {
      const data = await http.json(`https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap|video`)}&gsrnamespace=6&gsrlimit=6&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=1920&format=json&origin=*`);
      return Object.values(data?.query?.pages ?? {}).map(commonsAsset).filter(Boolean);
    }
  };
}

export function commonsAsset(page) {
  const info = page?.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const field = (name) => stripHtml(meta[name]?.value ?? "");
  const licence = normaliseLicence(`${field("LicenseShortName")} ${field("License")}`, field("LicenseUrl") || null);
  return {
    type: /^video\//.test(info.mime ?? "") ? "video" : "image",
    title: String(page.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
    author: field("Artist") || field("Credit") || null,
    licence,
    source_url: info.descriptionurl,
    media_url: info.url,
    preview_url: info.thumburl ?? null,
    width: info.width ?? null,
    height: info.height ?? null
  };
}

export function nasa() {
  return {
    id: "nasa",
    name: "NASA Image and Video Library",
    async search(http, query) {
      const data = await http.json(`https://images-api.nasa.gov/search?q=${encodeURIComponent(query)}&media_type=image,video&page_size=6`);
      return (data?.collection?.items ?? []).map((item) => {
        const meta = item.data?.[0] ?? {};
        // NASA's own media is not copyrighted; an item credited to someone else is not NASA's to give.
        const credit = meta.photographer ?? meta.secondary_creator ?? null;
        const thirdParty = credit && !/nasa|jpl|jsc|ksc|gsfc|msfc|arc|lrc|grc|afrc|ssc/i.test(credit);
        return {
          type: meta.media_type === "video" ? "video" : "image",
          title: meta.title,
          author: thirdParty ? null : `NASA${meta.center ? ` ${meta.center}` : ""}${credit ? ` / ${credit}` : ""}`,
          licence: thirdParty ? null : { id: "nasa-media", name: "NASA media (not copyrighted; no endorsement implied)", url: "https://www.nasa.gov/nasa-brand-center/images-and-media/" },
          source_url: `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id ?? "")}`,
          media_url: item.href ?? null,
          preview_url: item.links?.[0]?.href ?? null,
          date: meta.date_created ?? null
        };
      });
    }
  };
}

export function internetArchive() {
  return {
    id: "internet-archive",
    name: "Internet Archive",
    async search(http, query) {
      // Only items whose own licence field says public domain or CC: Prelinger films carry it, most others do not.
      const q = `(${query}) AND mediatype:(movies OR image) AND (collection:prelinger OR licenseurl:*publicdomain* OR licenseurl:*creativecommons.org/licenses/by/* OR licenseurl:*zero*)`;
      const data = await http.json(`https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&fl[]=year&fl[]=mediatype&fl[]=collection&rows=6&output=json`);
      return (data?.response?.docs ?? []).map((doc) => ({
        type: doc.mediatype === "movies" ? "video" : "image",
        title: doc.title,
        author: [doc.creator].flat().filter(Boolean)[0] ?? ([doc.collection].flat().includes("prelinger") ? "Prelinger Archives" : null),
        licence: normaliseLicence(doc.licenseurl ?? "", doc.licenseurl ?? null),
        source_url: `https://archive.org/details/${doc.identifier}`,
        media_url: `https://archive.org/download/${doc.identifier}`,
        date: doc.year ? String(doc.year) : null
      }));
    }
  };
}

export function libraryOfCongress() {
  return {
    id: "library-of-congress",
    name: "Library of Congress",
    async search(http, query) {
      const data = await http.json(`https://www.loc.gov/photos/?q=${encodeURIComponent(query)}&fo=json&c=6`);
      return (data?.results ?? []).map((result) => {
        const rights = [result.rights_advisory, result.rights, result.item?.rights_advisory].flat().filter(Boolean).join(" ");
        return {
          type: "image",
          title: result.title,
          author: [result.contributor, result.item?.contributor_names].flat().filter(Boolean)[0] ?? "Library of Congress",
          // "No known restrictions on publication" is the only rights text taken as clear.
          licence: /no known restrictions/i.test(rights) ? { id: "public-domain", name: "No known restrictions (Library of Congress)", url: "https://www.loc.gov/legal/understanding-copyright/" } : null,
          source_url: result.url ?? result.id,
          media_url: [result.image_url].flat().filter(Boolean).at(-1) ?? null,
          date: result.date ?? null
        };
      });
    }
  };
}

export function pexels(key) {
  return {
    id: "pexels",
    name: "Pexels",
    async search(http, query) {
      const headers = { authorization: key };
      const videos = await http.json(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=4&orientation=landscape`, { headers });
      const photos = await http.json(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`, { headers });
      return [
        ...(videos?.videos ?? []).map((video) => ({ type: "video", title: video.url?.split("/").filter(Boolean).pop()?.replace(/-\d+$/, "").replace(/-/g, " ") ?? `Pexels video ${video.id}`, author: video.user?.name ?? null, licence: { id: "pexels", name: "Pexels License", url: "https://www.pexels.com/license/" }, source_url: video.url, media_url: (video.video_files ?? []).sort((a, b) => (b.width ?? 0) - (a.width ?? 0)).find((file) => (file.width ?? 0) <= 1920)?.link ?? null, width: video.width, height: video.height, duration: video.duration })),
        ...(photos?.photos ?? []).map((photo) => ({ type: "image", title: photo.alt || `Pexels photo ${photo.id}`, author: photo.photographer ?? null, licence: { id: "pexels", name: "Pexels License", url: "https://www.pexels.com/license/" }, source_url: photo.url, media_url: photo.src?.large2x ?? photo.src?.original ?? null, width: photo.width, height: photo.height }))
      ];
    }
  };
}

export function pixabay(key) {
  return {
    id: "pixabay",
    name: "Pixabay",
    async search(http, query) {
      const videos = await http.json(`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=4&safesearch=true`);
      return (videos?.hits ?? []).map((hit) => ({ type: "video", title: hit.tags || `Pixabay video ${hit.id}`, author: hit.user ?? null, licence: { id: "pixabay", name: "Pixabay Content License", url: "https://pixabay.com/service/license-summary/" }, source_url: hit.pageURL, media_url: hit.videos?.large?.url || hit.videos?.medium?.url || null, width: hit.videos?.large?.width ?? null, height: hit.videos?.large?.height ?? null, duration: hit.duration ?? null }));
    }
  };
}

// ---------------------------------------------------------------------------

export function stripHtml(text) {
  return decodeEntities(String(text).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function interleave(list, keyOf) {
  const buckets = new Map();
  for (const item of list) buckets.set(keyOf(item), [...(buckets.get(keyOf(item)) ?? []), item]);
  const out = [];
  while ([...buckets.values()].some((bucket) => bucket.length)) for (const bucket of buckets.values()) if (bucket.length) out.push(bucket.shift());
  return out;
}

function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "asset";
}

function uniqueId(id, assets) {
  let candidate = id;
  for (let n = 2; assets.some((asset) => asset.id === candidate); n += 1) candidate = `${id}-${n}`;
  return candidate;
}
