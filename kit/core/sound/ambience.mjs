// Ambience beds: quiet, seamless loops for a world and time of day (office
// hum, cafe murmur, traffic, crickets, rain, waves, wind, server fans, a
// crowd, birdsong, room tone, a spaceship drone). Each bed is layers of
// filtered noise and simple tones shaped by slow envelopes and event trains,
// in the same spec form as an effect: {seconds, layers, master, space?}.
// The kit renders `seconds + CROSSFADE` and folds the overhang back over the
// head, so the file loops without a seam. The seed moves the event timings,
// voices and pitches inside each bed's character.
import { fmt, layer, noise, rng } from './dsp.mjs';
import { AMBIENCE_BEDS } from './options.mjs';

export const CROSSFADE = 3;

const band = (f, q = 1) => `bandpass=f=${fmt(f)}:width_type=q:w=${q}`;
const lfo = (f, phase = 0) => `sin(2*PI*${fmt(f)}*t+${fmt(phase)})`;
// Positive, lumpy "speech" envelope: a few incommensurate sines, rectified.
const syllables = (r) => `pow(max(0,0.5*${lfo(r.range(2.6, 3.6), r.range(0, 6))}+0.35*${lfo(r.range(4.2, 5.4), r.range(0, 6))}+0.3*${lfo(r.range(0.15, 0.3), r.range(0, 6))}-0.1),1.5)`;
// A gaussian bump repeating every `period` seconds, centred at `offset`.
const bump = (period, offset, width) => `exp(-pow((mod(t-${fmt(offset)},${fmt(period)})-${fmt(period / 2)})/${fmt(width)},2))`;
// A decaying strike repeating every `period` seconds from `offset`.
const strike = (period, offset, tau) => `exp(-mod(t-${fmt(offset)}+${fmt(period * 8)},${fmt(period)})/${fmt(tau)})`;

function wash(r, filter, { gain = 1, env = '1', k = 0 } = {}) {
  return layer(`${noise(k)}*${env}`, { right: `${noise(k + 1)}*${env}`, filter, gain, seed: r.seed() });
}

function babble(r, voices, { centre = 700, spread = 2.2, gain = 0.5, distance = 1800 } = {}) {
  const layers = [];
  for (let i = 0; i < voices; i++) {
    const f = centre * spread ** (r.range(-1, 1));
    const pan = r.range(0.25, 0.75);
    const env = syllables(r);
    layers.push(layer(`${fmt(pan)}*${noise(i % 4)}*${env}`, { right: `${fmt(1 - pan)}*${noise((i % 4) + 4)}*${env}`, filter: `${band(f, 1.4)},${band(f * 1.9, 2)},lowpass=f=${distance}`, gain: gain * 12, seed: r.seed() }));
  }
  return layers;
}

const BEDS = {
  office(r) {
    const keys = `gt(random(2),0.9994)*gt(${lfo(r.range(0.05, 0.09), r.range(0, 6))},0.2)`;
    return {
      seconds: 16,
      master: 'highpass=f=35,lowpass=f=9000',
      space: { seconds: 0.6, tone: 3500, mix: 0.25 },
      layers: [
        wash(r, 'lowpass=f=180,highpass=f=40', { gain: 1 }),
        wash(r, band(r.range(380, 480), 0.7), { gain: 0.18, k: 2 }),
        layer(`0.6*sin(2*PI*${fmt(r.pick([100, 120]))}*t)+0.25*sin(2*PI*${fmt(r.pick([200, 240]))}*t)`, { gain: 0.012, seed: r.seed() }),
        ...babble(r, 3, { centre: 520, gain: 0.08, distance: 1400 }),
        layer(`${keys}*(random(3)-0.5)*8`, { right: `${keys}*(random(3)-0.5)*6`, filter: `${band(r.range(2200, 2800), 2)},lowpass=f=4500`, gain: 0.35, seed: r.seed() })
      ]
    };
  },
  cafe(r) {
    const clinks = [0, 1, 2].map((i) => {
      const f = r.range(2400, 3600);
      const period = 16 / r.pick([3, 4, 5, 7]);
      const env = strike(period, r.range(0, period), 0.09);
      return layer(`(sin(2*PI*${fmt(f)}*t)+0.4*sin(2*PI*${fmt(f * 2.76)}*t))*${env}`, { right: `(sin(2*PI*${fmt(f * 1.001)}*t)+0.4*sin(2*PI*${fmt(f * 2.77)}*t))*${env}*${fmt(r.range(0.4, 1))}`, gain: 0.018 + 0.006 * i, seed: r.seed() });
    });
    const hissAt = r.range(4, 12);
    return {
      seconds: 16,
      master: 'highpass=f=60,lowpass=f=9000',
      space: { seconds: 0.9, tone: 3800, mix: 0.4 },
      layers: [
        wash(r, 'lowpass=f=320,highpass=f=50', { gain: 0.45 }),
        ...babble(r, 6, { centre: 650, gain: 0.16, distance: 2600 }),
        ...clinks,
        wash(r, 'highpass=f=2800,lowpass=f=7000', { gain: 0.05, env: `clip((t-${fmt(hissAt)})/0.4,0,1)*clip((${fmt(hissAt + 2.5)}-t)/0.8,0,1)`, k: 4 })
      ]
    };
  },
  'street-day'(r) {
    const cars = [0, 1, 2, 3].map(() => {
      const period = 16 / r.pick([1, 2, 3, 4]);
      const offset = r.range(0, period);
      const width = r.range(0.9, 1.6);
      const lead = r.range(-0.6, 0.6);
      return layer(`${noise(0)}*${bump(period, offset, width)}`, { right: `${noise(1)}*${bump(period, offset + lead, width)}`, filter: `${band(r.range(500, 900), 0.6)},lowpass=f=2400`, gain: r.range(0.45, 0.7), seed: r.seed() });
    });
    const hornAt = r.range(3, 12);
    const horn = `between(t,${fmt(hornAt)},${fmt(hornAt + 0.35)})*clip((t-${fmt(hornAt)})/0.02,0,1)*clip((${fmt(hornAt + 0.35)}-t)/0.05,0,1)*(sin(2*PI*${fmt(r.range(380, 420))}*t)+0.8*sin(2*PI*${fmt(r.range(480, 520))}*t)+0.3*sin(2*PI*${fmt(r.range(760, 840))}*t))`;
    return {
      seconds: 16,
      master: 'highpass=f=28,lowpass=f=8000',
      space: { seconds: 1.4, tone: 3000, mix: 0.3 },
      layers: [
        wash(r, 'lowpass=f=120,highpass=f=28', { gain: 1.1 }),
        wash(r, band(1800, 0.5), { gain: 0.05, k: 2 }),
        ...cars,
        layer(horn, { right: `0.7*${horn}`, filter: 'lowpass=f=1600', gain: 0.025, seed: r.seed() })
      ]
    };
  },
  'street-night'(r) {
    const passAt = r.range(2, 8);
    const sirenRate = r.range(0.22, 0.32);
    const sirenF = r.range(780, 980);
    const swing = r.range(220, 320);
    const siren = `sin(2*PI*${fmt(sirenF)}*t-${fmt(swing / sirenRate)}*cos(2*PI*${fmt(sirenRate)}*t))*pow(sin(PI*t/24),3)`;
    return {
      seconds: 24,
      master: 'highpass=f=25,lowpass=f=6000',
      space: { seconds: 2.2, tone: 2200, mix: 0.45 },
      layers: [
        wash(r, 'lowpass=f=90,highpass=f=25', { gain: 1 }),
        layer(`${noise(0)}*${bump(24, passAt + 6, 2)}`, { right: `${noise(1)}*${bump(24, passAt + 6.5, 2)}`, filter: `${band(500, 0.6)},lowpass=f=1200`, gain: 0.35, seed: r.seed() }),
        layer(`${noise(0)}*${bump(12, passAt, 2.5)}`, { right: `${noise(1)}*${bump(12, passAt + 0.4, 2.5)}`, filter: `${band(400, 0.6)},lowpass=f=900`, gain: 0.25, seed: r.seed() }),
        layer(siren, { right: `0.8*${siren}`, filter: 'lowpass=f=1800,highpass=f=300', gain: 0.022, seed: r.seed() })
      ]
    };
  },
  crickets(r) {
    const crickets = [0, 1, 2].map(() => {
      const f = r.range(4100, 5200);
      const group = r.range(0.48, 0.75);
      const offset = r.range(0, group);
      const pulses = r.range(26, 34);
      const pan = r.range(0.2, 0.8);
      const gate = `lt(mod(t+${fmt(offset)},${fmt(group)}),0.12)*pow(max(0,sin(2*PI*${fmt(pulses)}*t)),2)*(0.7+0.3*${lfo(r.range(0.05, 0.1), r.range(0, 6))})`;
      return layer(`${fmt(pan)}*sin(2*PI*${fmt(f)}*t)*${gate}`, { right: `${fmt(1 - pan)}*sin(2*PI*${fmt(f)}*t)*${gate}`, gain: 0.12, seed: r.seed() });
    });
    return {
      seconds: 16,
      master: 'highpass=f=40,lowpass=f=9000',
      space: { seconds: 1.2, tone: 6000, mix: 0.35 },
      layers: [
        wash(r, 'lowpass=f=380,highpass=f=40', { gain: 0.25, env: `(0.7+0.3*${lfo(0.0625, r.range(0, 6))})` }),
        ...crickets
      ]
    };
  },
  rain(r) {
    return {
      seconds: 16,
      master: 'highpass=f=40,lowpass=f=10000',
      layers: [
        wash(r, 'highpass=f=900,lowpass=f=7500', { gain: 0.35 }),
        wash(r, 'lowpass=f=160,highpass=f=40', { gain: 0.7, k: 2 }),
        layer(`gt(random(0),0.996)*(random(1)-0.5)*6`, { right: `gt(random(2),0.996)*(random(3)-0.5)*6`, filter: `${band(r.range(1600, 2400), 3)},lowpass=f=6000`, gain: 0.6, seed: r.seed() }),
        layer(`gt(random(0),0.9993)*(random(1)-0.5)*6`, { right: `gt(random(2),0.9993)*(random(3)-0.5)*6`, filter: band(r.range(500, 800), 2.5), gain: 0.9, seed: r.seed() })
      ]
    };
  },
  waves(r) {
    const period = r.pick([8, 9, 6]);
    const seconds = period * (period === 6 ? 3 : 2);
    const env = (shift) => `pow(max(0,sin(PI*mod(t-${fmt(shift)},${fmt(period)})/${fmt(period)})),2.5)`;
    const crash = (shift) => `pow(max(0,sin(PI*mod(t-${fmt(shift)},${fmt(period)})/${fmt(period)})),8)`;
    const lag = r.range(0.2, 0.5);
    return {
      seconds,
      master: 'highpass=f=30,lowpass=f=9000',
      layers: [
        layer(`${noise(0)}*${env(0)}`, { right: `${noise(1)}*${env(lag)}`, filter: 'lowpass=f=900,highpass=f=40', gain: 1, seed: r.seed() }),
        layer(`${noise(2)}*${crash(0)}`, { right: `${noise(3)}*${crash(lag)}`, filter: 'highpass=f=1200,lowpass=f=6500', gain: 0.35, seed: r.seed() }),
        layer(`${noise(0)}*${env(period * 0.35)}`, { right: `${noise(1)}*${env(period * 0.35 + lag)}`, filter: `${band(2600, 0.8)}`, gain: 0.12, seed: r.seed() }),
        wash(r, 'lowpass=f=300', { gain: 0.25, k: 4 })
      ]
    };
  },
  wind(r) {
    const gust = `(0.55+0.3*${lfo(r.range(0.06, 0.09), r.range(0, 6))}+0.15*${lfo(r.range(0.17, 0.23), r.range(0, 6))})`;
    return {
      seconds: 16,
      master: 'highpass=f=30,lowpass=f=7000',
      layers: [
        wash(r, `${band(r.range(300, 450), 0.5)}`, { gain: 1, env: gust }),
        wash(r, `${band(r.range(800, 1100), 4)}`, { gain: 0.35, env: `pow(${gust},3)`, k: 2 }),
        wash(r, 'lowpass=f=120', { gain: 0.5, env: gust, k: 4 })
      ]
    };
  },
  'server-room'(r) {
    const blade = r.range(160, 220);
    return {
      seconds: 16,
      master: 'highpass=f=30,lowpass=f=10000',
      space: { seconds: 0.5, tone: 5000, mix: 0.2 },
      layers: [
        wash(r, 'highpass=f=200,lowpass=f=3500', { gain: 0.45 }),
        wash(r, 'lowpass=f=260,highpass=f=30', { gain: 0.7, k: 2 }),
        layer(`sin(2*PI*${fmt(blade)}*t)+0.8*sin(2*PI*${fmt(blade * 1.019)}*t)+0.3*sin(2*PI*${fmt(blade * 2)}*t)`, { right: `sin(2*PI*${fmt(blade * 1.004)}*t)+0.8*sin(2*PI*${fmt(blade * 1.022)}*t)+0.3*sin(2*PI*${fmt(blade * 2.01)}*t)`, gain: 0.02, seed: r.seed() }),
        layer(`sin(2*PI*${fmt(r.pick([100, 120]))}*t)`, { gain: 0.015, seed: r.seed() })
      ]
    };
  },
  crowd(r) {
    return {
      seconds: 16,
      master: 'highpass=f=60,lowpass=f=8000',
      space: { seconds: 1.6, tone: 3200, mix: 0.5 },
      layers: [
        wash(r, 'lowpass=f=400,highpass=f=60', { gain: 0.4 }),
        ...babble(r, 10, { centre: 700, gain: 0.15, distance: 2800 })
      ]
    };
  },
  birds(r) {
    const birds = [0, 1, 2].map(() => {
      const f = r.range(2300, 3800);
      const trill = r.range(14, 22);
      const depth = r.range(250, 600);
      const phrase = 16 / r.pick([3, 4, 5]);
      const offset = r.range(0, phrase);
      const length = r.range(0.4, 0.9);
      const note = r.range(0.07, 0.12);
      const pan = r.range(0.2, 0.8);
      const gate = `lt(mod(t-${fmt(offset)}+${fmt(phrase * 8)},${fmt(phrase)}),${fmt(length)})*pow(max(0,sin(PI*mod(t,${fmt(note * 1.6)})/${fmt(note)})),1.5)*lt(mod(t,${fmt(note * 1.6)}),${fmt(note)})`;
      const tone = `sin(2*PI*${fmt(f)}*t-${fmt(depth / trill)}*cos(2*PI*${fmt(trill)}*t))*${gate}`;
      return layer(`${fmt(pan)}*${tone}`, { right: `${fmt(1 - pan)}*${tone}`, gain: 0.1, seed: r.seed() });
    });
    return {
      seconds: 16,
      master: 'highpass=f=50,lowpass=f=9000',
      space: { seconds: 1.1, tone: 6000, mix: 0.35 },
      layers: [
        wash(r, band(r.range(2500, 3500), 0.6), { gain: 0.07, env: `(0.6+0.4*${lfo(r.range(0.1, 0.2), r.range(0, 6))})` }),
        wash(r, 'lowpass=f=250,highpass=f=40', { gain: 0.2, k: 2 }),
        ...birds
      ]
    };
  },
  'room-tone'(r) {
    return {
      seconds: 16,
      master: 'highpass=f=35,lowpass=f=6000',
      layers: [
        wash(r, 'lowpass=f=350,highpass=f=35', { gain: 1 }),
        wash(r, band(r.range(900, 1400), 0.5), { gain: 0.06, k: 2 }),
        layer(`sin(2*PI*${fmt(r.pick([50, 60]))}*t)+0.3*sin(2*PI*${fmt(r.pick([100, 120]))}*t)`, { gain: 0.008, seed: r.seed() })
      ]
    };
  },
  'space-hum'(r) {
    const root = r.range(42, 58);
    const voice = (ratio, beat) => `sin(2*PI*${fmt(root * ratio)}*t)*(0.7+0.3*${lfo(beat, r.range(0, 6))})`;
    return {
      seconds: 16,
      master: 'highpass=f=25,lowpass=f=3000',
      space: { seconds: 2.5, tone: 2000, mix: 0.4 },
      layers: [
        layer(`${voice(1, 0.0625)}+0.6*${voice(1.5, 0.125)}+0.4*${voice(2.01, 0.1875)}`, { right: `${voice(1.003, 0.0625)}+0.6*${voice(1.505, 0.125)}+0.4*${voice(2.0, 0.25)}`, gain: 0.25, seed: r.seed() }),
        wash(r, `${band(r.range(200, 320), 0.8)}`, { gain: 0.4, env: `(0.6+0.4*${lfo(0.0625, r.range(0, 6))})` }),
        wash(r, 'lowpass=f=90', { gain: 0.6, k: 2 })
      ]
    };
  }
};

for (const name of AMBIENCE_BEDS) if (!BEDS[name]) throw new Error(`ambience bed ${name} has no recipe`);

/** One bed's spec for a seed: {name, seconds, crossfade, layers, master, space?}. */
export function ambienceSpec(name, seed = 'launchclip') {
  const recipe = BEDS[name];
  if (!recipe) throw new Error(`Unknown ambience bed "${name}". Beds: ${AMBIENCE_BEDS.join(', ')}`);
  const spec = recipe(rng(`${seed}|ambience|${name}`));
  return { name, crossfade: CROSSFADE, ...spec };
}
