/** Tiny synthesized sound effects — no audio assets needed. */
let ctx: AudioContext | null = null;
let muted = false;

const ac = () => {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
};

const tone = (freq: number, dur: number, type: OscillatorType, vol = 0.15, slide = 0) => {
  if (muted) return;
  const a = ac();
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, a.currentTime);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
};

const noise = (dur: number, vol = 0.12, hp = 800) => {
  if (muted) return;
  const a = ac();
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
};

export const sfx = {
  unlock: () => void ac(),
  toggle: () => (muted = !muted),
  get muted() {
    return muted;
  },
  step: () => noise(0.05, 0.05, 1800),
  swing: () => noise(0.12, 0.09, 2500),
  hit: () => {
    tone(140, 0.15, "square", 0.12, -60);
    noise(0.08, 0.1, 400);
  },
  hurt: () => tone(220, 0.25, "sawtooth", 0.13, -120),
  bow: () => tone(420, 0.18, "triangle", 0.12, -250),
  chest: () => {
    tone(660, 0.12, "square", 0.08);
    setTimeout(() => tone(990, 0.2, "square", 0.08), 90);
  },
  death: () => tone(180, 0.8, "sawtooth", 0.15, -140),
  border: () => tone(90, 0.4, "sine", 0.12, 40),
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, "square", 0.08), i * 140)),
  click: () => tone(800, 0.04, "square", 0.05),
};
