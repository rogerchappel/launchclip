// Exact frame rates, frame/seconds conversion and SMPTE timecode for the NLE
// writers (src/nle/*). Every timeline value is an integer frame count on one
// rate; the writers turn frames into each format's own time notation.
//
// Rates are rationals so NTSC rates stay exact: 29.97 is 30000/1001, never
// 29.97. Timecode for 29.97 and 59.94 is drop-frame by default (frame numbers
// 00 and 01, or 00-03 at 59.94, are skipped at the start of every minute
// except each tenth), so the timecode clock tracks wall-clock time.

const NAMED = new Map([
  ["23.976", [24000, 1001]], ["23.98", [24000, 1001]], ["24", [24, 1]], ["25", [25, 1]],
  ["29.97", [30000, 1001]], ["30", [30, 1]], ["48", [48, 1]], ["50", [50, 1]],
  ["59.94", [60000, 1001]], ["60", [60, 1]]
]);

export const SUPPORTED_RATES = [...NAMED.keys()];

/**
 * A frame rate from 24, 25, 29.97, "30000/1001", … →
 * {num, den, fps, timebase, ntsc, dropFrame, label}.
 * timebase: the integer nominal rate (30 for 29.97); ntsc: den is 1001.
 * dropFrame: default true for NTSC 29.97/59.94; pass {dropFrame:false} for NDF.
 */
export function parseRate(value, { dropFrame } = {}) {
  let num, den;
  if (value && typeof value === "object" && Number.isInteger(value.num) && Number.isInteger(value.den)) ({ num, den } = value);
  else {
    const text = String(value ?? "").trim();
    const rational = /^(\d+)\/(\d+)$/.exec(text);
    if (rational) { num = Number(rational[1]); den = Number(rational[2]); }
    else if (NAMED.has(text)) [num, den] = NAMED.get(text);
    else if (/^\d+$/.test(text) && Number(text) > 0 && Number(text) <= 240) { num = Number(text); den = 1; }
    else {
      const numeric = Number(text);
      const match = [...NAMED.values()].find(([n, d]) => d === 1001 && Math.abs(n / d - numeric) < 0.01);
      if (!match) throw new Error(`Unsupported frame rate ${JSON.stringify(value)}; use one of ${SUPPORTED_RATES.join(", ")} or a rational like 30000/1001`);
      [num, den] = match;
    }
  }
  if (!(num > 0 && den > 0)) throw new Error(`Invalid frame rate ${num}/${den}`);
  const divisor = gcd(num, den);
  num /= divisor; den /= divisor;
  const ntsc = den === 1001;
  const timebase = Math.round(num / den);
  if (!ntsc && den !== 1) throw new Error(`Unsupported frame rate ${num}/${den}; NLE timelines need an integer rate or an NTSC x/1001 rate`);
  const df = ntsc && (timebase === 30 || timebase === 60) ? dropFrame !== false : false;
  return { num, den, fps: num / den, timebase, ntsc, dropFrame: df, label: ntsc ? (num / den).toFixed(2).replace(/0$/, "") : String(timebase) };
}

/** Seconds → the nearest whole frame on `rate`. */
export function secondsToFrames(seconds, rate) {
  return Math.round(Number(seconds) * rate.num / rate.den + 1e-9);
}

/** Frames → seconds (a float; use frameTime for exact notation). */
export function framesToSeconds(frames, rate) {
  return frames * rate.den / rate.num;
}

/** Frames → an exact rational {num, den} seconds, reduced. */
export function framesToRational(frames, rate) {
  const num = frames * rate.den;
  const den = rate.num;
  if (num === 0) return { num: 0, den: 1 };
  const divisor = gcd(Math.abs(num), den);
  return { num: num / divisor, den: den / divisor };
}

/** FCPXML time: "0s", "3s" or "1001/30000s" — exact, reduced. */
export function fcpTime(frames, rate) {
  const { num, den } = framesToRational(frames, rate);
  return den === 1 ? `${num}s` : `${num}/${den}s`;
}

/** Parse an FCPXML time ("1001/30000s", "3s") into a rational {num, den}. */
export function parseFcpTime(value) {
  const match = /^(-?\d+)(?:\/(\d+))?s$/.exec(String(value ?? "").trim());
  if (!match) throw new Error(`Not an FCPXML time: ${JSON.stringify(value)}`);
  return { num: Number(match[1]), den: match[2] ? Number(match[2]) : 1 };
}

/** An FCPXML time → frames on `rate`; throws when it is not on the frame grid. */
export function fcpTimeToFrames(value, rate) {
  const { num, den } = parseFcpTime(value);
  const frames = (num * rate.num) / (den * rate.den);
  if (Math.abs(frames - Math.round(frames)) > 1e-9) throw new Error(`FCPXML time ${value} is not on the ${rate.label} fps frame grid`);
  return Math.round(frames);
}

/** FCPXML frameDuration of a rate: "1/30s", "1001/30000s". */
export function frameDuration(rate) {
  return `${rate.den}/${rate.num}s`;
}

/**
 * Frames → SMPTE timecode "HH:MM:SS:FF" (non-drop) or "HH:MM:SS;FF" (drop
 * frame). The count is from 00:00:00:00 plus `start` frames of offset.
 */
export function framesToTimecode(frames, rate, { start = 0 } = {}) {
  let n = Math.max(0, Math.round(frames + start));
  const fps = rate.timebase;
  if (rate.dropFrame) {
    const drop = fps === 60 ? 4 : 2;
    const perMinute = fps * 60 - drop;
    const perTen = fps * 600 - drop * 9;
    const tens = Math.floor(n / perTen);
    const rem = n % perTen;
    n += drop * 9 * tens + (rem > drop ? drop * Math.floor((rem - drop) / perMinute) : 0);
  }
  const ff = n % fps;
  const totalSeconds = Math.floor(n / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600) % 24;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}${rate.dropFrame ? ";" : ":"}${pad(ff)}`;
}

/** SMPTE timecode → frames (drop-frame aware; ';' or the rate decides). */
export function timecodeToFrames(timecode, rate) {
  const match = /^(\d{2}):(\d{2}):(\d{2})([:;.,])(\d{2})$/.exec(String(timecode).trim());
  if (!match) throw new Error(`Not a timecode: ${JSON.stringify(timecode)}`);
  const [hh, mm, ss, ff] = [match[1], match[2], match[3], match[5]].map(Number);
  const fps = rate.timebase;
  const totalMinutes = hh * 60 + mm;
  let frames = ((hh * 3600) + (mm * 60) + ss) * fps + ff;
  if (rate.dropFrame) {
    const drop = fps === 60 ? 4 : 2;
    frames -= drop * (totalMinutes - Math.floor(totalMinutes / 10));
  }
  return frames;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function gcd(a, b) {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}
