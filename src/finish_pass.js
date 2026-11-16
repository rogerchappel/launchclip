import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { FINISH_PROTECT_FEATHER, FINISH_PROTECT_MAX, resolveFinish } from "@launchclip/core/finish.mjs";
import { applyGrade, storyGradeCube } from "./grade.js";
import { VERTEX, fragmentShader, passProtects, passUniforms, preShader } from "./finish_shaders.js";

// The finishing pass (docs/FINISHING_AND_ELEMENTS_RFC.md §E.1): ffmpeg
// decodes the finished render to RGBA, one headless Chrome page runs the
// story's GLSL chain (src/finish_shaders.js) on a WebGL2 canvas, and ffmpeg
// encodes the result. Frames go in over loopback HTTP and come back over a
// WebSocket (Chrome uploads an 8 MB fetch body about 8x slower). It
// runs after either renderer, so the finish is in parity by construction.
// The plan (which passes, the protect mask): kit/core/finish.mjs.

// ffmpeg as a child whose `done` settles when it exits.
function ffmpeg(args, { input = false } = {}) {
  const child = spawn("ffmpeg", args, { stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
  let err = "";
  child.stderr.on("data", (chunk) => { err = (err + chunk).slice(-4000); });
  child.done = new Promise((ok, fail) => {
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}: ${err.trim()}`))));
  });
  child.done.catch(() => {});
  return child;
}

// Reads fixed-size frames from a stream, at most a few ahead.
function frameReader(stream, size) {
  let chunks = [], have = 0, ended = false, wake = null;
  const poke = () => { const w = wake; wake = null; w?.(); };
  stream.on("data", (chunk) => { chunks.push(chunk); have += chunk.length; if (have >= size * 3) stream.pause(); poke(); });
  stream.on("end", () => { ended = true; poke(); });
  return async () => {
    while (have < size && !ended) { stream.resume(); await new Promise((resolve) => { wake = resolve; }); }
    if (have < size) return null;
    const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
    const rest = all.subarray(size);
    chunks = rest.length ? [rest] : []; have = rest.length;
    if (have < size * 3) stream.resume();
    return all.subarray(0, size);
  };
}

// The server end of a WebSocket (RFC 6455) that only receives: each whole
// binary message goes to onMessage, and a one-byte text frame acks it.
function acceptSocket(req, socket, onMessage) {
  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let chunks = [], have = 0, parts = [], busy = Promise.resolve();
  socket.on("data", (chunk) => {
    chunks.push(chunk); have += chunk.length;
    for (;;) {
      const head = chunks.length > 1 && chunks[0].length < 14 ? Buffer.concat(chunks) : chunks[0];
      if (!head || head.length < 2) return;
      const fin = head[0] & 0x80, op = head[0] & 15;
      let len = head[1] & 127, at = 2;
      if (len === 126) { if (head.length < 4) return; len = head.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (head.length < 10) return; len = Number(head.readBigUInt64BE(2)); at = 10; }
      if (have < at + 4 + len) return;
      const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
      const mask = all.subarray(at, at + 4), data = all.subarray(at + 4, at + 4 + len);
      for (let i = 0; i < len; i += 1) data[i] ^= mask[i & 3];
      const rest = all.subarray(at + 4 + len);
      chunks = rest.length ? [rest] : []; have = rest.length;
      if (op === 8) { socket.end(); return; }
      parts.push(data);
      if (!fin) continue;
      const message = parts.length === 1 ? parts[0] : Buffer.concat(parts);
      parts = [];
      busy = busy.then(() => onMessage(message)).then(() => socket.write(Buffer.from([0x81, 1, 49])), (error) => socket.destroy(error));
    }
  });
}

// The page: compiles each pass, then per frame uploads the input, draws the
// chain through two framebuffers and sends the last one back.
const PAGE = `<!doctype html><meta charset="utf-8"><canvas id="c"></canvas><script>
window.finishRun = async () => {
  const cfg = await (await fetch('/config')).json();
  const W = cfg.width, H = cfg.height, size = W * H * 4;
  const canvas = document.getElementById('c'); canvas.width = W; canvas.height = H;
  const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL2 is not available in this Chromium');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const texture = (w, h, format, type, data, filter) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, gl.RGBA, type, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const vert = shader(gl.VERTEX_SHADER, cfg.vertex);
  let lut = null;
  if (cfg.lut) {
    const data = new Float32Array(await (await fetch('/lut')).arrayBuffer());
    lut = texture(cfg.lut * cfg.lut, cfg.lut, gl.RGBA32F, gl.FLOAT, data, gl.NEAREST);
  }
  // A program and a setter that picks the uniform call from its declared type.
  const program = (fragment) => {
    const prog = gl.createProgram();
    gl.attachShader(prog, vert); gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const types = {};
    for (let i = 0; i < gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS); i++) { const u = gl.getActiveUniform(prog, i); types[u.name.endsWith('[0]') ? u.name.slice(0, -3) : u.name] = u; }
    const set = (name, v) => {
      const u = types[name], at = gl.getUniformLocation(prog, name);
      if (!u) return;
      if (u.type === gl.INT || u.type === gl.SAMPLER_2D) gl.uniform1i(at, v);
      else if (u.type === gl.FLOAT_VEC2) gl.uniform2fv(at, v);
      else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(at, v);
      else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(at, v);
      else if (u.size > 1) gl.uniform1fv(at, v);
      else gl.uniform1f(at, v);
    };
    return { prog, set };
  };
  const passes = cfg.passes.map((pass) => ({ ...pass, main: program(pass.fragment), pre: pass.pre ? program(pass.pre) : null }));
  // The pre-pass target: mipmapped, so a pass reads it at any pyramid level.
  let pre = null;
  if (passes.some((pass) => pass.pre)) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(W, H))) + 1, gl.RGBA8, W, H);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    pre = { t, f };
  }
  const src = texture(W, H, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR);
  const targets = [0, 1].map(() => { const t = texture(W, H, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, f }; });
  gl.viewport(0, 0, W, H);
  const fetchIn = async () => { const r = await fetch('/in'); return r.status === 204 ? null : new Uint8Array(await r.arrayBuffer()); };
  const ws = new WebSocket('ws://' + location.host + '/out');
  ws.binaryType = 'arraybuffer';
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('finish pass: the frame socket did not open')); });
  let next = fetchIn(), n = 0;
  for (;;) {
    const frame = await next;
    if (!frame) break;
    next = fetchIn();
    const index = cfg.frameStart + n, t = index / cfg.fps;
    const rects = cfg.rects.filter((r) => t >= r.start && t < r.end).slice(0, ${FINISH_PROTECT_MAX});
    const flat = new Float32Array(${FINISH_PROTECT_MAX} * 4);
    rects.forEach((r, i) => flat.set([r.x, r.y, r.width, r.height], i * 4));
    gl.bindTexture(gl.TEXTURE_2D, src);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    let input = src;
    const draw = ({ prog, set }, pass, target, protect) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.f);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, input); set('u_src', 0);
      if (lut) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lut); set('u_lut', 1); set('u_n', cfg.lut); }
      if (pre && target !== pre) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pre.t); set('u_pre', 2); }
      set('u_res', [W, H]); set('u_frame', index); set('u_t', t); set('u_fps', cfg.fps);
      set('u_protect', protect ? 1 : 0); set('u_rects', flat); set('u_nrects', rects.length); set('u_feather', cfg.feather);
      for (const [name, v] of Object.entries(pass.uniforms)) set(name, v);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    passes.forEach((pass, i) => {
      if (pass.pre) {
        draw(pass.pre, pass, pre, false);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, pre.t); gl.generateMipmap(gl.TEXTURE_2D);
      }
      const out = targets[i % 2];
      draw(pass.main, pass, out, pass.protect);
      input = out.t;
    });
    const pixels = new Uint8Array(size);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // The next input is already on its way; waiting for the ack keeps one frame in flight.
    await new Promise((ok, no) => { ws.onmessage = ok; ws.onclose = () => no(new Error('finish pass: the frame socket closed')); ws.send(pixels); });
    n += 1;
  }
  ws.close();
  return n;
};
</script>`;

/** The Chromium the finish pass draws in (Playwright's, a system Chrome or a renderer's). Throws with where it looked. */
async function launchChromium() {
  const { chromiumSearch, chromiumMissingMessage, loadPlaywright } = await import("./demo/record.js");
  const chromium = await loadPlaywright();
  if (!chromium) throw new Error("story.finish needs Chromium: the optional dependency playwright is not installed (npm i playwright)");
  let pinned = null;
  try { pinned = chromium.executablePath(); } catch { pinned = null; }
  const found = await chromiumSearch({ playwrightPath: pinned });
  if (!found.path) throw new Error(`story.finish needs Chromium: ${chromiumMissingMessage(found.looked)}`);
  return chromium.launch({ executablePath: found.path });
}

/**
 * Run `chain` ([{pass, params}], grade params already turned into `cube`)
 * over `input` into `output`. kind "video" re-encodes H.264 and copies the
 * audio; "image" writes one still, or a numbered sequence when `output` has a
 * %d pattern. frameStart is the first input frame's number in the story.
 * → frames drawn
 */
export async function runFinishPass({ input, output, chain, width, height, fps, frameStart = 0, rects = [], cube = null, kind = "video" }) {
  const size = width * height * 4;
  const decoder = ffmpeg(["-hide_banner", "-loglevel", "error", "-i", input, "-vf", `scale=${width}:${height}:in_color_matrix=bt709:in_range=tv,format=rgba`, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"]);
  const raw = ["-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-r", String(fps), "-i", "pipe:0"];
  const encodeArgs = kind === "image"
    ? ["-hide_banner", "-loglevel", "error", "-y", ...raw, ...(output.includes("%") ? ["-start_number", String(frameStart)] : ["-frames:v", "1"]), output]
    : ["-hide_banner", "-loglevel", "error", "-y", ...raw, "-i", input, "-map", "0:v", "-map", "1:a?", "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:a", "copy", "-movflags", "+faststart", output];
  const encoder = ffmpeg(encodeArgs, { input: true });
  const next = frameReader(decoder.stdout, size);
  // The cube as RGBA floats, (N·N)×N, red fastest: the layout the grade shader reads.
  const lut = cube ? Float32Array.from({ length: cube.size ** 3 * 4 }, (_, i) => (i % 4 === 3 ? 1 : cube.data[(i >> 2) * 3 + (i % 4)])) : null;
  const config = {
    width, height, fps, frameStart, rects, feather: FINISH_PROTECT_FEATHER, vertex: VERTEX, lut: cube?.size ?? 0,
    passes: chain.map(({ pass, params }) => ({ pass, fragment: fragmentShader(pass), pre: preShader(pass), protect: passProtects(pass), uniforms: passUniforms(pass, params) }))
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); }
      else if (req.url === "/config") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(config)); }
      else if (req.url === "/lut") { res.writeHead(200); res.end(Buffer.from(lut.buffer)); }
      else if (req.url === "/in") { const frame = await next(); if (frame) { res.writeHead(200); res.end(frame); } else { res.writeHead(204); res.end(); } }
      else { res.writeHead(404); res.end(); }
    } catch (error) { res.writeHead(500); res.end(String(error.message)); }
  });
  server.on("upgrade", (req, socket) => acceptSocket(req, socket, async (pixels) => {
    if (!encoder.stdin.write(pixels)) await new Promise((resolve) => encoder.stdin.once("drain", resolve));
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await launchChromium();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const frames = await page.evaluate(() => window.finishRun());
    encoder.stdin.end();
    await Promise.all([decoder.done, encoder.done]);
    if (!frames) throw new Error(`finish pass: ffmpeg decoded no frames from ${input}`);
    return frames;
  } catch (error) {
    decoder.kill("SIGKILL"); encoder.kill("SIGKILL");
    throw error;
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

/** The chain with the grade's params turned into its cube: {chain, cube}. */
export async function finishChain(project, story, chain) {
  let cube = null;
  const out = [];
  for (const entry of chain) {
    if (entry.pass !== "grade") { out.push(entry); continue; }
    const graded = await storyGradeCube(project, story, entry.params);
    if (graded) { cube = graded.cube; out.push(entry); }
  }
  return { chain: out, cube };
}

/**
 * Finish `file` in place: the story's shader chain when it lists one (the
 * grade inside it), else the grade alone through ffmpeg lut3d (src/grade.js).
 * `protect` → the protect mask's rects (kit/core/finish.mjs protectRects).
 * → {passes, grade} or the grade-only result (null when nothing applies)
 */
export async function applyFinish(project, story, file, { format, protect = async () => [], grade = applyGrade } = {}) {
  const resolved = resolveFinish(story);
  if (!resolved) return grade(project, story, file);
  const { chain, cube } = await finishChain(project, story, resolved);
  const temporary = path.join(path.dirname(file), `.${path.basename(file, path.extname(file))}.finishing${path.extname(file) || ".mp4"}`);
  try {
    await runFinishPass({ input: path.resolve(file), output: path.resolve(temporary), chain, ...format, rects: await protect(), cube });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return { passes: chain.map((entry) => entry.pass) };
}
