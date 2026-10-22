// Synthetic voice-like test signals for the audio enhancement tests.

const RATE = 48000;
// Fixed scattered harmonic phases keep the crest factor speech-like rather than sawtooth-sharp.
const PHASES = Array.from({ length: 29 }, (_, index) => (index * 2.399) % (2 * Math.PI));

function rng(seed) { let state = seed >>> 0; return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 * 2 - 1; }; }

/** A voice-like signal: gliding harmonic voicing with breath, syllable envelopes and fricative bursts, separated by pauses. */
export function syntheticVoice({ seconds = 8, rate = RATE, seed = 1 } = {}) {
  const random = rng(seed);
  const samples = new Float32Array(Math.round(seconds * rate));
  const phrases = [[1.0, 2.6], [3.4, 5.4], [6.4, 7.6]];
  let phase = 0;
  let jitter = 0;
  for (let index = 0; index < samples.length; index++) {
    const t = index / rate;
    const phrase = phrases.find(([start, end]) => t >= start && t < end);
    if (!phrase) continue;
    const local = t - phrase[0];
    const f0 = 120 + 30 * Math.sin(2 * Math.PI * 0.7 * t) + 8 * Math.sin(2 * Math.PI * 5 * t);
    jitter = 0.99 * jitter + 0.01 * random();
    phase += 2 * Math.PI * f0 * (1 + jitter) / rate;
    let voiced = 0;
    for (let harmonic = 1; harmonic <= 28; harmonic++) voiced += Math.sin(harmonic * phase + PHASES[harmonic]) / Math.sqrt(harmonic);
    const syllable = Math.max(0, Math.sin(Math.PI * 4 * local)) ** 0.6;
    const edge = Math.min(1, local / 0.03, (phrase[1] - t) / 0.03);
    const breath = random() * 0.03;
    const fricative = Math.sin(Math.PI * 4 * local) < -0.6 ? random() * 0.25 : 0;
    samples[index] = 0.08 * edge * (syllable * (voiced + breath) + fricative);
  }
  return samples;
}

export function addNoise(clean, { snrDb = 15, humDb = -40, humHz = 60, seed = 7, rate = RATE } = {}) {
  const random = rng(seed);
  let power = 0; let count = 0;
  for (let at = 0; at + 960 <= clean.length; at += 960) {
    let sum = 0;
    for (let index = at; index < at + 960; index++) sum += clean[index] ** 2;
    if (sum / 960 > 1e-5) { power += sum / 960; count++; }
  }
  const target = Math.sqrt(power / count) / 10 ** (snrDb / 20);
  const pink = new Float32Array(clean.length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; let pinkPower = 0;
  for (let index = 0; index < pink.length; index++) {
    const white = random();
    b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
    pink[index] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362; b6 = white * 0.115926;
    pinkPower += pink[index] ** 2;
  }
  const scale = target / Math.sqrt(pinkPower / pink.length);
  const hum = humDb === null ? 0 : 10 ** (humDb / 20);
  return Float32Array.from(clean, (value, index) => {
    const t = index / rate;
    return value + pink[index] * scale + hum * (Math.sin(2 * Math.PI * humHz * t) + 0.5 * Math.sin(2 * Math.PI * 2 * humHz * t) + 0.3 * Math.sin(2 * Math.PI * 3 * humHz * t));
  });
}

