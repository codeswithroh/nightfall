/** Synthesized sound effects and ambience. No audio files. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let ambience: { stop: () => void } | null = null;

const ac = () => {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
};
const out = () => (ac(), master!);

/** pan: -1 (left) … 1 (right) */
const tone = (freq: number, dur: number, type: OscillatorType, vol = 0.15, slide = 0, pan = 0, delay = 0) => {
  if (muted) return;
  const a = ac();
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  const p = a.createStereoPanner();
  p.pan.value = pan;
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(p).connect(out());
  o.start(t);
  o.stop(t + dur + 0.02);
};

const noiseBuffer = (seconds: number) => {
  const a = ac();
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * seconds), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
};

const noise = (dur: number, vol = 0.12, freq = 800, type: BiquadFilterType = "highpass", pan = 0) => {
  if (muted) return;
  const a = ac();
  const src = a.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  const p = a.createStereoPanner();
  p.pan.value = pan;
  src.connect(f).connect(g).connect(p).connect(out());
  src.start();
};

/** Crickets + low wind, looped quietly under the whole match. */
function startAmbience() {
  const a = ac();
  const wind = a.createBufferSource();
  wind.buffer = noiseBuffer(4);
  wind.loop = true;
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 380;
  const wg = a.createGain();
  wg.gain.value = 0.035;
  // Slow swell so the wind breathes.
  const lfo = a.createOscillator();
  const lfoGain = a.createGain();
  lfo.frequency.value = 0.08;
  lfoGain.gain.value = 0.02;
  lfo.connect(lfoGain).connect(wg.gain);
  wind.connect(lp).connect(wg).connect(out());
  wind.start();
  lfo.start();
  const chirp = setInterval(() => {
    if (muted || Math.random() < 0.35) return;
    const pan = Math.random() * 2 - 1;
    const f = 4200 + Math.random() * 900;
    for (let i = 0; i < 3; i++) tone(f, 0.035, "sine", 0.012, 0, pan, i * 0.06);
  }, 900);
  return {
    stop: () => {
      clearInterval(chirp);
      wind.stop();
      lfo.stop();
    },
  };
}

export const sfx = {
  unlock: () => void ac(),
  toggle: () => {
    muted = !muted;
    if (master) master.gain.value = muted ? 0 : 0.9;
    return muted;
  },
  get muted() {
    return muted;
  },
  ambience(on: boolean) {
    if (on && !ambience && !muted) ambience = startAmbience();
    if (!on && ambience) {
      ambience.stop();
      ambience = null;
    }
  },
  step: () => noise(0.05, 0.05, 1800),
  swing: () => noise(0.12, 0.09, 2500),
  hit: () => {
    tone(140, 0.15, "square", 0.12, -60);
    noise(0.08, 0.12, 400);
  },
  hurt: () => tone(220, 0.25, "sawtooth", 0.13, -120),
  bow: () => tone(420, 0.18, "triangle", 0.12, -250),
  chest: () => {
    tone(660, 0.12, "square", 0.08);
    tone(990, 0.2, "square", 0.08, 0, 0, 0.09);
    tone(1320, 0.25, "square", 0.06, 0, 0, 0.18);
  },
  death: () => tone(180, 0.8, "sawtooth", 0.15, -140),
  border: () => tone(90, 0.4, "sine", 0.12, 40),
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, "square", 0.08, 0, 0, i * 0.14)),
  click: () => tone(800, 0.04, "square", 0.05),
  /** A muffled footstep from an unseen enemy, panned toward where it came from. */
  heard: (pan: number) => {
    noise(0.07, 0.06, 260, "lowpass", pan);
    noise(0.07, 0.05, 220, "lowpass", pan * 0.9);
  },
  heartbeat: () => {
    tone(58, 0.12, "sine", 0.32);
    tone(52, 0.14, "sine", 0.26, 0, 0, 0.18);
  },
  beep: (final = false) => tone(final ? 1320 : 880, final ? 0.3 : 0.1, "square", 0.06),
  spotted: () => {
    tone(330, 0.09, "square", 0.06);
    tone(440, 0.12, "square", 0.06, 0, 0, 0.08);
  },
  streak: (n: number) => [392, 523, 659, 784, 1046].slice(0, n + 2).forEach((f, i) => tone(f, 0.18, "square", 0.08, 0, 0, i * 0.09)),
  tick: () => tone(1200, 0.02, "square", 0.025),
};
