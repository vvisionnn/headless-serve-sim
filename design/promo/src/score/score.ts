/**
 * The score: an original piece, synthesized, rendered offline so every render
 * is sample-identical. 96 BPM in D, sixteen bars, written to the edit:
 *
 *   I–II   Dmaj9 → Bm11 pads out of silence, a four-note bell motif
 *   III    pulse enters; the Stage assembles on G, rises on A into the sweep
 *   IV     light: the motif again, one note per device landing on the wall
 *   V      dark: kick and ticks under the terminal, a scale for /ax, a shutter
 *   VI     breakdown on Asus2 while the code condenses
 *   VII    a sub drop on the downbeat, the motif resolves, the chord rings out
 *
 * Sound effects are scored to the film's own cues, so picture and sound
 * cannot drift apart.
 */
import { BAR, BEAT, commands, cue, keyTimes, land } from "../film/cues";
import { AX_TIMES, PALETTE_KEYS, INSTALL_KEYS, WALL_LANDINGS } from "../film/beats";

export const SAMPLE_RATE = 48000;

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const N: Record<string, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};
/** "F#4" → MIDI number. */
const m = (name: string) => {
  const [, pc, oct] = /^([A-G]#?)(-?\d)$/.exec(name)!;
  return N[pc!]! + (Number(oct) + 1) * 12;
};
const chord = (s: string) => s.split(" ").map(m);

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export async function renderScore(duration = cue.end): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const rand = seeded(20261020);

  // ── Buses: dry and a long, soft hall; a gentle glue compressor, then a limiter.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.knee.value = 12;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.02;
  glue.release.value = 0.25;
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.9, 0);
  master.gain.setValueAtTime(0.9, cue.fade);
  master.gain.linearRampToValueAtTime(0, duration);
  // Make-up gain after the glue brings it to about -16 LUFS; the limiter keeps peaks under -1 dBTP.
  const makeup = ctx.createGain();
  makeup.gain.value = 1.33;
  master.connect(glue).connect(makeup).connect(limiter).connect(ctx.destination);

  const hall = ctx.createConvolver();
  const irLen = Math.floor(SAMPLE_RATE * 3.6);
  const ir = ctx.createBuffer(2, irLen, SAMPLE_RATE);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) {
      const t = i / SAMPLE_RATE;
      d[i] = (rand() * 2 - 1) * Math.exp(-t * 1.9) * (t < 0.012 ? t / 0.012 : 1);
    }
  }
  hall.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  hall.connect(wet).connect(master);

  const noise = ctx.createBuffer(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  noise.getChannelData(0).forEach((_, i, d) => (d[i] = rand() * 2 - 1));

  /** Route a voice to the mix: level, pan, and how much hall it gets. */
  function out(node: AudioNode, level: number, pan = 0, send = 0.3) {
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(g).connect(p);
    p.connect(master);
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = send;
      p.connect(s).connect(hall);
    }
  }

  function noiseSource(t: number, dur: number) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.start(t, rand() * 1.5);
    src.stop(t + dur);
    return src;
  }

  // ── Instruments ────────────────────────────────────────────────────────
  /** Warm pad: detuned saws through a slowly opening low-pass. */
  function pad(
    t0: number,
    t1: number,
    notes: number[],
    o: { level?: number; cutoff?: [number, number]; attack?: number; release?: number } = {},
  ) {
    const { level = 0.05, cutoff = [700, 1800], attack = 1.4, release = 1.8 } = o;
    notes.forEach((note, i) => {
      const f = mtof(note);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.6;
      lp.frequency.setValueAtTime(cutoff[0], t0);
      lp.frequency.exponentialRampToValueAtTime(cutoff[1], t1);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(1, t0 + attack);
      env.gain.setValueAtTime(1, t1);
      env.gain.linearRampToValueAtTime(0, t1 + release);
      for (const cents of [-7, 6]) {
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = f;
        osc.detune.value = cents + (rand() - 0.5) * 3;
        osc.connect(lp);
        osc.start(t0);
        osc.stop(t1 + release + 0.1);
      }
      lp.connect(env);
      out(env, level / Math.sqrt(notes.length), (i / (notes.length - 1 || 1) - 0.5) * 0.7, 0.55);
    });
  }

  /** Glass bell: two-operator FM with an inharmonic ratio, long decay. */
  function bell(t: number, note: number, level = 0.09, decay = 2.4, pan = 0) {
    const f = mtof(note);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 3.51;
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.6, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + decay * 0.6);
    mod.connect(idx).connect(car.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0008, t + decay);
    car.connect(env);
    for (const o of [car, mod]) {
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    out(env, level, pan, 0.6);
  }

  /** Soft mallet: a sine with a short triangle transient. Plucks and tocks. */
  function mallet(t: number, note: number, level = 0.08, decay = 0.6, pan = 0, send = 0.35) {
    const f = mtof(note);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0006, t + decay);
    const body = ctx.createOscillator();
    body.frequency.value = f;
    const tick = ctx.createOscillator();
    tick.type = "triangle";
    tick.frequency.value = f * 4;
    const tickEnv = ctx.createGain();
    tickEnv.gain.setValueAtTime(0.35, t);
    tickEnv.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    tick.connect(tickEnv).connect(env);
    body.connect(env);
    for (const o of [body, tick]) {
      o.start(t);
      o.stop(t + decay + 0.05);
    }
    out(env, level, pan, send);
  }

  function sub(t0: number, t1: number, note: number, level = 0.12) {
    const osc = ctx.createOscillator();
    osc.frequency.value = mtof(note);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + 0.4);
    env.gain.setValueAtTime(1, t1);
    env.gain.linearRampToValueAtTime(0, t1 + 0.6);
    osc.connect(env);
    osc.start(t0);
    osc.stop(t1 + 0.7);
    out(env, level, 0, 0);
  }

  function kick(t: number, level = 0.32) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(118, t);
    osc.frequency.exponentialRampToValueAtTime(43, t + 0.13);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + 0.45);
    out(env, level, 0, 0.04);
  }

  function hat(t: number, level = 0.03, pan = 0.25) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7600;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    noiseSource(t, 0.06).connect(hp).connect(env);
    out(env, level, pan, 0.12);
  }

  /** A tiny key or UI click: band-passed noise, a few milliseconds long. */
  function click(t: number, level = 0.06, freq = 3200, pan = 0) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    noiseSource(t, 0.03).connect(bp).connect(env);
    out(env, level, pan, 0.08);
  }

  /** Air moving past: noise through a band-pass that sweeps with the motion. */
  function whoosh(t: number, dur: number, level = 0.12, from = 300, to = 5200, pan = 0) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + dur * 0.62);
    env.gain.linearRampToValueAtTime(0, t + dur);
    noiseSource(t, dur + 0.05)
      .connect(bp)
      .connect(env);
    out(env, level, pan, 0.45);
  }

  /** The floor drops: a falling sub sine with a soft noise thump. */
  function boom(t: number, level = 0.5) {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(62, t);
    osc.frequency.exponentialRampToValueAtTime(34, t + 1.8);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, t + 2.6);
    osc.connect(env);
    osc.start(t);
    osc.stop(t + 2.7);
    out(env, level, 0, 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    const thump = ctx.createGain();
    thump.gain.setValueAtTime(1, t);
    thump.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    noiseSource(t, 0.4).connect(lp).connect(thump);
    out(thump, level * 0.25, 0, 0.3);
  }

  function shutter(t: number) {
    click(t, 0.16, 2400);
    click(t + 0.055, 0.12, 1800);
    whoosh(t, 0.16, 0.05, 2000, 6000);
  }

  // ── The piece ──────────────────────────────────────────────────────────
  const bar = (n: number) => n * BAR;
  const D9 = chord("D3 A3 E4 F#4 C#5");
  const Bm11 = chord("B2 F#3 A3 D4 E4");
  const G7 = chord("G2 D3 F#3 B3 C#4");
  const Asus = chord("A2 E3 F#3 B3 D4");
  const D9hi = chord("D3 A3 F#4 A4 C#5 E5");
  const Bm9 = chord("B2 F#3 A3 C#4 D4");
  const G9 = chord("G2 D3 F#3 A3 B3");
  const Em9 = chord("E2 B2 D3 F#3 G3");
  const A2 = chord("A2 E3 B3 E4");

  // Pads, bar by bar.
  pad(0, bar(2) - 0.2, D9, { level: 0.07, cutoff: [300, 1500], attack: 3.2 });
  pad(bar(2) - 0.2, bar(4) - 0.2, Bm11, { level: 0.07, cutoff: [900, 1600], attack: 1.2 });
  pad(bar(4) - 0.2, bar(5) - 0.1, G7, { level: 0.07, cutoff: [1000, 2200], attack: 0.8 });
  pad(bar(5) - 0.1, bar(6) - 0.1, Asus, { level: 0.075, cutoff: [1200, 4200], attack: 0.6 });
  pad(bar(6) - 0.1, bar(8) - 0.2, D9hi, { level: 0.07, cutoff: [2200, 3000], attack: 0.5 });
  pad(bar(8) - 0.2, bar(9), Bm9, { level: 0.065, cutoff: [800, 1500], attack: 0.7 });
  pad(bar(9), bar(10), Bm9, { level: 0.06, cutoff: [1500, 1800], attack: 0.3 });
  pad(bar(10), bar(11), G9, { level: 0.06, cutoff: [1500, 2000], attack: 0.5 });
  pad(bar(11), bar(12), Em9, { level: 0.06, cutoff: [1600, 2400], attack: 0.5 });
  pad(bar(12), bar(13) + 0.1, A2, { level: 0.06, cutoff: [1200, 2600], attack: 0.6 });
  pad(bar(13) + 0.1, cue.end, D9hi, {
    level: 0.08,
    cutoff: [1400, 2600],
    attack: 1.0,
    release: 2.5,
  });

  // Sub bass follows the roots once the room is lit.
  const roots: [number, number, string][] = [
    [bar(4), bar(5), "G1"],
    [bar(5), bar(6), "A1"],
    [bar(6), bar(8), "D2"],
    [bar(8), bar(10), "B1"],
    [bar(10), bar(11), "G1"],
    [bar(11), bar(12), "E1"],
    [bar(13), cue.end - 1.5, "D2"],
  ];
  for (const [a, z, n] of roots) sub(a, z, m(n), 0.1);

  // The motif: A5 F#5 E5 D5 — heard as the screen wakes, on the wall, at the end.
  const motif = chord("A5 F#5 E5 D5");
  bell(cue.screenOn, motif[0]!, 0.07, 3.2, -0.2);
  bell(cue.screenOn + BEAT * 2, motif[1]!, 0.055, 3, 0.2);
  bell(cue.screenOn + BEAT * 4, motif[2]!, 0.05, 3, -0.1);
  bell(cue.glide + BEAT * 2, motif[3]!, 0.05, 3.4, 0.15);

  // Pulse: soft 8th-note plucks from bar 3, walking the chord.
  const pulse = (from: number, to: number, notes: number[], level: number) => {
    for (let t = from, i = 0; t < to - 0.01; t += BEAT / 2, i++)
      mallet(
        t,
        notes[(i * 3) % notes.length]! + 12,
        level * (i % 2 ? 0.6 : 1),
        0.32,
        ((i % 4) - 1.5) * 0.25,
        0.25,
      );
  };
  pulse(bar(2), bar(4), Bm11, 0.035);
  pulse(bar(4), bar(5), G7, 0.04);
  pulse(bar(5), bar(6), Asus, 0.045);
  pulse(bar(6), bar(8), D9hi.slice(0, 5), 0.04);
  pulse(bar(8), bar(10), Bm9, 0.04);
  pulse(bar(10), bar(11), G9, 0.04);
  pulse(bar(11), bar(12), Em9, 0.04);

  // Drums: half-time from the Stage, four on the floor under the terminal.
  for (let t = bar(4); t < bar(8) - 0.01; t += BEAT * 2) kick(t, 0.22);
  for (let t = bar(6); t < bar(8) - 0.01; t += BEAT) hat(t + BEAT / 2, 0.025);
  for (let t = bar(8) + BEAT * 1; t < bar(12) - 0.01; t += BEAT) kick(t, 0.26);
  for (let t = bar(8) + BEAT; t < bar(12) - 0.01; t += BEAT / 2)
    hat(t + BEAT / 4, 0.02, rand() - 0.5);

  // ── Sound to picture ───────────────────────────────────────────────────
  whoosh(cue.rise - 0.2, 1.6, 0.05, 120, 900);
  whoosh(cue.windowGone - 0.1, 0.9, 0.08, 1800, 7000, 0.1);
  whoosh(cue.glide, 1.0, 0.06, 300, 1600, -0.3);
  whoosh(cue.unlock, 0.6, 0.06, 600, 4800);
  for (const [t, pan] of [
    [cue.navigator, -0.7],
    [cue.inspector, 0.7],
    [cue.dock, 0],
  ] as const)
    whoosh(t - 0.15, 0.7, 0.05, 250, 2400, pan);
  click(cue.click, 0.14, 2600, -0.1);
  click(cue.palette - 0.12, 0.12, 2800, 0.25);
  bell(cue.palette, m("E6"), 0.035, 1.2, 0.2);
  for (const t of PALETTE_KEYS) click(t, 0.05, 3000 + rand() * 1200, 0.1);
  click(cue.paletteRun, 0.1, 2400);
  whoosh(cue.light - 0.9, 1.0, 0.07, 400, 9000);
  whoosh(cue.light, 1.4, 0.14, 6000, 500);
  whoosh(cue.stageOut - 0.1, 0.8, 0.06, 2400, 300);
  WALL_LANDINGS.forEach(({ t }, i) =>
    mallet(t, chord("D5 F#5 A5 C#6 E6")[i % 5]!, 0.09, 1.2, (i / 4 - 0.5) * 0.9, 0.5),
  );
  whoosh(cue.unfold, 1.3, 0.06, 500, 3200, 0.2);
  whoosh(cue.wallOut, 0.7, 0.06, 3000, 300);
  whoosh(cue.dark - 0.6, 0.7, 0.07, 500, 8000, -0.4);
  whoosh(cue.dark, 1.3, 0.12, 7000, 400, -0.4);
  for (const c of Object.values(commands)) {
    for (const t of keyTimes(c.text, c.at)) click(t, 0.045, 2800 + rand() * 1800, -0.35);
    click(land(c) - 0.06, 0.09, 1900, -0.35);
  }
  mallet(land(commands.tap), m("D6"), 0.07, 0.4, 0.4, 0.3);
  whoosh(land(commands.tap) + 0.05, 0.6, 0.05, 900, 4000, 0.4);
  AX_TIMES.forEach((t, i) =>
    bell(t, chord("D6 E6 F#6 A6 B6 D7 E7 F#7 A7 B7 D8")[i % 11]!, 0.022, 0.9, 0.4),
  );
  shutter(land(commands.shot));
  whoosh(land(commands.shot) + 0.2, 0.9, 0.05, 2600, 600, -0.2);
  whoosh(cue.terminalOut, 0.7, 0.05, 2000, 300);
  for (let i = 0; i < 26; i++)
    bell(
      cue.qr + 0.25 + rand() * 0.9,
      m("A6") + [0, 2, 4, 7, 9, 12][Math.floor(rand() * 6)]!,
      0.012,
      0.7,
      rand() * 1.4 - 0.7,
    );
  whoosh(cue.mark - BAR / 2, BAR / 2, 0.08, 200, 6000);
  boom(cue.mark, 0.55);
  bell(cue.mark, motif[0]!, 0.06, 4.5, -0.2);
  bell(cue.mark + BEAT * 2, motif[1]!, 0.05, 4.5, 0.2);
  bell(cue.mark + BEAT * 4, motif[2]!, 0.045, 4.5, -0.1);
  bell(cue.mark + BEAT * 7, motif[3]!, 0.05, 6, 0.1);
  bell(cue.mark + BEAT * 7, m("D6"), 0.03, 6, -0.1);
  for (const t of INSTALL_KEYS) click(t, 0.035, 3000 + rand() * 1500, 0.1);

  return ctx.startRendering();
}

/** 16-bit PCM WAV. */
export function toWav(buffer: AudioBuffer): ArrayBuffer {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o: number, s: string) =>
    s.split("").forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  data.setUint32(4, 36 + len * ch * 2, true);
  str(8, "WAVEfmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  str(36, "data");
  data.setUint32(40, len * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, c) => buffer.getChannelData(c));
  for (let i = 0, o = 44; i < len; i++) {
    for (let c = 0; c < ch; c++, o += 2) {
      const s = Math.max(-1, Math.min(1, chans[c]![i]!));
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return data.buffer;
}
