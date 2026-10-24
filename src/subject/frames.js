// ffmpeg frame I/O for the subject stage: decode a source range to raw RGB
// frames, and encode RGBA frames to a VP9 WebM with alpha.

import { spawn } from "node:child_process";
import { once } from "node:events";

/**
 * Decode `src` from `start` for `duration` seconds as RGB24 frames of
 * width × height. fps: output rate (null keeps the source rate).
 * Yields Buffers of width * height * 3 bytes, in order.
 */
export async function* readFrames(src, { start = 0, duration, width, height, fps = null, ffmpeg = "ffmpeg" }) {
  const filters = [...(fps ? [`fps=${fps}`] : []), `scale=${width}:${height}:flags=area`];
  const args = ["-hide_banner", "-loglevel", "error", "-ss", String(start), ...(duration ? ["-t", String(duration)] : []), "-i", src, "-an", "-vf", filters.join(","), "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"];
  const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = once(child, "close");
  const frameBytes = width * height * 3;
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of child.stdout) {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      while (pending.length >= frameBytes) {
        yield pending.subarray(0, frameBytes);
        pending = pending.subarray(frameBytes);
      }
    }
    const [code] = await exited;
    if (code !== 0) throw new Error(`ffmpeg could not decode ${src}: ${stderr.trim() || `exit ${code}`}`);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

/**
 * An RGBA → VP9-with-alpha WebM writer.
 * → {write(rgba Buffer) → Promise, close() → Promise}
 */
export function openMatteWriter(out, { width, height, fps, crf = 32, ffmpeg = "ffmpeg" }) {
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "pipe:0",
    "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", String(crf), "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", "-auto-alt-ref", "0", "-an", out];
  const child = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = once(child, "close");
  let failed = null;
  child.stdin.on("error", (error) => {
    failed = error;
  });
  return {
    async write(rgba) {
      if (failed) throw failed;
      if (!child.stdin.write(rgba)) await once(child.stdin, "drain");
    },
    async close() {
      child.stdin.end();
      const [code] = await exited;
      if (code !== 0) throw new Error(`ffmpeg could not encode ${out}: ${stderr.trim() || `exit ${code}`}`);
    }
  };
}

/** RGB24 frame + alpha mask → RGBA frame. */
export function withAlpha(rgb, alpha) {
  const pixels = alpha.length;
  const out = Buffer.allocUnsafe(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    out[i * 4] = rgb[i * 3];
    out[i * 4 + 1] = rgb[i * 3 + 1];
    out[i * 4 + 2] = rgb[i * 3 + 2];
    out[i * 4 + 3] = alpha[i];
  }
  return out;
}
