// Generates placeholder SFX (synthesized with ffmpeg) and logo marks so the
// MotionGolden composition renders before you've sourced real assets.
// Replace public/sfx/*.wav with a real sound pack when you have one.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.join(root, "..", "public");
const sfxDir = path.join(publicDir, "sfx");
const logoDir = path.join(publicDir, "logos");
const baseDir = path.join(publicDir, "base");

mkdirSync(sfxDir, { recursive: true });
mkdirSync(logoDir, { recursive: true });
mkdirSync(baseDir, { recursive: true });

const SFX = {
  // Short noise sweep — stands in for a whoosh.
  "whoosh.wav": "anoisesrc=d=0.28:c=pink:a=0.55,afade=t=in:d=0.05,afade=t=out:st=0.12:d=0.16,highpass=f=400,lowpass=f=6000",
  // Quick sine blip with fast decay — stands in for a pop.
  "pop.wav": "sine=frequency=620:duration=0.16,afade=t=out:st=0.03:d=0.13,volume=0.8",
  // Tiny tick.
  "tick.wav": "sine=frequency=1900:duration=0.05,afade=t=out:st=0.01:d=0.04,volume=0.5"
};

for (const [name, filter] of Object.entries(SFX)) {
  const target = path.join(sfxDir, name);
  if (existsSync(target)) continue;
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", filter, "-ar", "48000", target], { stdio: "pipe" });
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

const LOGOS = {
  "terminal.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="#0b0e14"/><path d="M22 34l16 14-16 14" stroke="#22c55e" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="46" y="58" width="26" height="7" rx="3.5" fill="#fafafa"/></svg>`,
  "launchclip.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="#121417"/><path d="M30 66V30h10v27h22v9z" fill="#ffd60a"/><circle cx="63" cy="38" r="9" fill="#22c55e"/></svg>`
};

for (const [name, svg] of Object.entries(LOGOS)) {
  const target = path.join(logoDir, name);
  if (existsSync(target)) continue;
  writeFileSync(target, `${svg}\n`);
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

writeFileSync(
  path.join(baseDir, "README.md"),
  "Drop your talking-head recording here as `talking-head.mp4` (9:16, 720x1280 or better).\nThe golden timeline points at `base/talking-head.mp4`; the generated stand-in is a moving gradient — replace it with your take.\n"
);

// Stand-in base footage so the golden timeline renders before you record.
const baseVideo = path.join(baseDir, "talking-head.mp4");
if (!existsSync(baseVideo)) {
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", "gradients=s=720x1280:d=19:speed=0.02:c0=0x10141c:c1=0x223046", "-pix_fmt", "yuv420p", baseVideo],
    { stdio: "pipe" }
  );
  console.log(`wrote ${path.relative(process.cwd(), baseVideo)} (stand-in — replace with your recording)`);
}
console.log("done");
