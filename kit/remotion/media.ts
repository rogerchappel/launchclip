// Asset URLs for the Remotion kit. A story names its media as project-relative
// paths (assets/…, docs/KIT_CONTRACTS.md), which the LaunchClip CLI serves from
// the Remotion public dir through staticFile(). An app that embeds the kit
// (@launchclip/remotion) keeps its media elsewhere, so it installs a resolver
// once, before rendering: every image, video, audio, caption and SVG layer
// src goes through it. Without one, absolute URLs (https:, data:, blob:, //…)
// pass through and everything else is staticFile(src).
import { staticFile } from "remotion";

/** src → URL, or null/undefined for the default (pass-through or staticFile). */
export type AssetResolver = (src: string) => string | null | undefined;

const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
let resolver: AssetResolver | null = null;

/** Installs (or with null removes) the app's asset resolver. */
export function setAssetResolver(next: AssetResolver | null): void {
  resolver = next;
}

export function assetUrl(src: string): string {
  const resolved = resolver ? resolver(src) : null;
  if (resolved != null) return resolved;
  return ABSOLUTE.test(src) ? src : staticFile(src);
}
