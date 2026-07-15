import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const HYPERFRAMES_MAPPED_FAMILIES = new Set([
  "inter", "montserrat", "outfit", "nunito", "oswald", "league gothic", "archivo black",
  "space mono", "ibm plex mono", "jetbrains mono", "eb garamond", "playfair display",
  "source code pro", "noto sans jp", "roboto", "open sans", "lato", "poppins",
  "helvetica neue", "helvetica", "arial", "helvetica bold", "futura", "din alternate",
  "arial black", "bebas neue", "courier new", "courier", "garamond", "noto sans japanese",
  "segoe ui", "sf pro", "sf pro display", "sf pro text", "sf pro rounded", "avenir",
  "avenir next", "lucida grande", "geneva", "optima", "verdana", "tahoma", "trebuchet ms",
  "calibri", "candara", "corbel", "lucida sans", "lucida sans unicode", "noto sans",
  "dejavu sans", "liberation sans", "sf mono", "menlo", "monaco", "consolas",
  "lucida console", "lucida sans typewriter", "andale mono", "dejavu sans mono",
  "liberation mono", "georgia", "palatino", "palatino linotype", "book antiqua", "cambria",
  "times", "times new roman", "dejavu serif", "liberation serif"
]);
const GENERIC_FAMILIES = new Set(["serif", "sans-serif", "monospace", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace"]);

export function productionFontFamilies(plan) {
  return [...new Set(Object.values(plan?.design?.style_dna?.typography ?? {})
    .map(plannedFamily)
    .filter((family) => family && !GENERIC_FAMILIES.has(family.toLowerCase()) && !HYPERFRAMES_MAPPED_FAMILIES.has(family.toLowerCase())))]
    .sort((left, right) => left.localeCompare(right));
}

export async function freezeProductionFonts(families, assetsDir, options = {}) {
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("Font freezing requires fetch");
  const rules = [];
  const assets = [];
  for (const family of families) {
    const cssUrl = googleFontsCssUrl(family);
    const cssResponse = await fetcher(cssUrl, { headers: { "User-Agent": "Mozilla/5.0 Chrome/131 Safari/537.36" }, signal: AbortSignal.timeout(20_000) });
    if (!cssResponse.ok) throw new Error(`Could not resolve Google Font ${family}: HTTP ${cssResponse.status}`);
    const css = await cssResponse.text();
    if (css.length > 500_000) throw new Error(`Google Font CSS was unexpectedly large for ${family}`);
    const faces = parseGoogleFontFaces(css);
    if (!faces.length) throw new Error(`Google Fonts returned no WOFF2 faces for ${family}`);
    if (faces.length > 64) throw new Error(`Google Fonts returned too many faces for ${family}: ${faces.length}`);
    for (const [index, face] of faces.entries()) {
      const fontUrl = new URL(face.url);
      if (fontUrl.protocol !== "https:" || fontUrl.hostname !== "fonts.gstatic.com") throw new Error(`Google Font ${family} returned an unsupported asset host`);
      const response = await fetcher(fontUrl.href, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Could not freeze Google Font ${family}: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error(`Google Font face has an invalid size for ${family}: ${bytes.length}`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const file = `font-${slug(family)}-${slug(face.weight)}-${slug(face.style)}-${sha256.slice(0, 12)}.woff2`;
      await writeFile(path.join(assetsDir, file), bytes, { mode: 0o600 });
      const id = `font:${slug(family)}:${index + 1}`;
      assets.push({ id, file, sha256, source: fontUrl.href });
      rules.push([
        "@font-face {",
        `  font-family: ${JSON.stringify(family)};`,
        `  src: url("assets/${file}") format("woff2");`,
        `  font-style: ${face.style};`,
        `  font-weight: ${face.weight};`,
        "  font-display: block;",
        ...(face.unicodeRange ? [`  unicode-range: ${face.unicodeRange};`] : []),
        "}"
      ].join("\n"));
    }
  }
  return { css: rules.join("\n\n"), assets };
}

export function injectProductionFontFaces(html, css) {
  if (!css) return String(html ?? "");
  const source = String(html ?? "");
  if (/<style\b[^>]*>/i.test(source)) return source.replace(/<style\b[^>]*>/i, (tag) => `${tag}\n${css}\n`);
  return source.replace(/<template\b[^>]*>/i, (tag) => `${tag}<style>\n${css}\n</style>`);
}

function plannedFamily(value) {
  const planned = String(value ?? "").trim();
  const described = planned.match(/^(.+?)\s+(?:[1-9]00(?:[\/\u2013-][1-9]00)?|thin|extra[- ]?light|light|regular|medium|semi[- ]?bold|bold|extra[- ]?bold|black)(?=\s|,|$)/i);
  return String(described?.[1] ?? planned).replace(/^["']|["']$/g, "").trim();
}

function googleFontsCssUrl(family) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700;900&display=swap`;
}

function parseGoogleFontFaces(css) {
  const faces = [];
  const seen = new Set();
  for (const match of String(css).matchAll(/@font-face\s*\{([\s\S]*?)\}/gi)) {
    const block = match[1];
    const url = block.match(/src\s*:\s*url\((?:["']?)(https:\/\/[^)'"\s]+)(?:["']?)\)\s*format\(["']woff2["']\)/i)?.[1];
    if (!url) continue;
    const weight = block.match(/font-weight\s*:\s*([^;]+)/i)?.[1]?.trim() || "400";
    const style = block.match(/font-style\s*:\s*(normal|italic|oblique)/i)?.[1]?.toLowerCase() || "normal";
    const unicodeRange = block.match(/unicode-range\s*:\s*([^;]+)/i)?.[1]?.trim() || null;
    if (!/^\d{3}(?:\s+\d{3})?$/.test(weight)) throw new Error(`Google Fonts returned an unsupported weight: ${weight}`);
    const key = [url, weight, style, unicodeRange].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push({ url, weight, style, unicodeRange });
  }
  return faces;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "font";
}
