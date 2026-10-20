/**
 * The score: an original piece, synthesized and rendered offline, so every
 * render is sample-identical. 120 BPM in D, thirty bars, written to the edit:
 *
 *   I     three hits on three words; a riser pulls into the slam
 *   II    the groove drops: four on the floor, a pumping bass, a 16th arp
 *   III   the Stage is played like an instrument: every panel, click, key and
 *         toggle has its sound, on its frame
 *   IV    the console ticks; the accessibility pass scans up a scale
 *   V     breakdown for the wall: landings in the low end, the hinge's whir
 *   VI    the drop under the terminal: claps, open hats, shutters
 *   VII   a hush while the code condenses
 *   VIII  the wordmark lands on the downbeat; the chord rings out
 *
 * Every sound effect reads its time from the same cues the picture does, so
 * picture and sound cannot drift apart.
 */
import { CLICKS, KEYS } from "../film/acts/stage-ui";
import { consoleAx, consoleHot, CONSOLE_LOG_TIMES } from "../film/acts/console";
import { loopShotAt, LOOP_SHOTS } from "../film/acts/commands";
import { TOASTS } from "../film/acts/toasts";
import { axNodes } from "../film/assets";
import { AX_TIMES, INSTALL_KEYS, PALETTE_KEYS, wallLandings } from "../film/beats";
import { BAR, BEAT, commands, cue, keyTimes, land } from "../film/cues";
import { HINGE_DUR } from "../film/layout";

export const SAMPLE_RATE = 48000;

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const N: Record<string, number> = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
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

function firstTime(test: (t: number) => boolean, from: number, to: number) {
  for (let t = from; t < to; t += 0.002) if (test(t)) return t;
  return to;
}

export async function renderScore(duration = cue.end): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SAMPLE_RATE), SAMPLE_RATE);
  const rand = seeded(20261020);
  const bar = (n: number) => n * BAR;

  // ── Buses ──────────────────────────────────────────────────────────────
  // Music goes through a bus that ducks on every kick (the pump); effects sit
  // on top of it, dry. A glue compressor and a limiter hold the master.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -18;
  glue.knee.value = 10;
  glue.ratio.value = 3;
  glue.attack.value = 0.012;
  glue.release.value = 0.18;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.3;
  const master = ctx.createGain();
  master.gain.setValueAtTime(1, 0);
  master.gain.setValueAtTime(1, cue.fade);
  master.gain.linearRampToValueAtTime(0, duration);
  // The limiter has no look-ahead, so transients overshoot it; trim after it for headroom.
  const trim = ctx.createGain();
  trim.gain.value = 0.84;
  master.connect(glue).connect(makeup).connect(limiter).connect(trim).connect(ctx.destination);

  /** The music bus: everything tonal and rhythmic except the kick, filtered and pumped. */
  const musicFilter = ctx.createBiquadFilter();
  musicFilter.type = "lowpass";
  musicFilter.Q.value = 0.7;
  const pump = ctx.createGain();
  musicFilter.connect(pump).connect(master);

  const hall = ctx.createConvolver();
  const irLen = Math.floor(SAMPLE_RATE * 2.8);
  const ir = ctx.createBuffer(2, irLen, SAMPLE_RATE);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < irLen; i++) {
      const t = i / SAMPLE_RATE;
      d[i] = (rand() * 2 - 1) * Math.exp(-t * 2.4) * (t < 0.01 ? t / 0.01 : 1);
    }
  }
  hall.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.36;
  hall.connect(wet).connect(master);

  const noise = ctx.createBuffer(1, SAMPLE_RATE * 2, SAMPLE_RATE);
  noise.getChannelData(0).forEach((_, i, d) => (d[i] = rand() * 2 - 1));

  /** Route a voice: level, pan, hall send; music voices go through the pumped bus. */
  function out(node: AudioNode, level: number, pan = 0, send = 0.25, music = false) {
    const g = ctx.createGain();
    g.gain.value = level;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(g).connect(p);
    p.connect(music ? musicFilter : master);
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

  function env(t: number, attack: number, decay: number, peak = 1) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t + attack + decay);
    return g;
  }

  function osc(type: OscillatorType, freq: number, t: number, dur: number) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  // ── Instruments ────────────────────────────────────────────────────────
  function pad(t0: number, t1: number, notes: number[], level = 0.05, cutoff: [number, number] = [900, 2200], attack = 0.6) {
    notes.forEach((note, i) => {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.5;
      lp.frequency.setValueAtTime(cutoff[0], t0);
      lp.frequency.exponentialRampToValueAtTime(cutoff[1], t1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + attack);
      g.gain.setValueAtTime(1, t1 - 0.05);
      g.gain.linearRampToValueAtTime(0, t1 + 0.4);
      for (const cents of [-9, 8]) {
        const o = osc("sawtooth", mtof(note), t0, t1 - t0 + 0.5);
        o.detune.value = cents + (rand() - 0.5) * 4;
        o.connect(lp);
      }
      lp.connect(g);
      out(g, level / Math.sqrt(notes.length), (i / (notes.length - 1 || 1) - 0.5) * 0.8, 0.45, true);
    });
  }

  function pluck(t: number, note: number, level = 0.05, pan = 0, decay = 0.22) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + decay);
    const e = env(t, 0.002, decay);
    osc("sawtooth", mtof(note), t, decay).connect(lp);
    osc("square", mtof(note) * 1.003, t, decay).connect(lp);
    lp.connect(e);
    out(e, level, pan, 0.2, true);
  }

  function bass(t: number, note: number, dur: number, level = 0.16) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + dur * 0.9);
    const e = env(t, 0.004, dur);
    osc("sawtooth", mtof(note), t, dur).connect(lp);
    osc("sine", mtof(note - 12), t, dur).connect(e);
    lp.connect(e);
    out(e, level, 0, 0, true);
  }

  function bell(t: number, note: number, level = 0.06, decay = 1.8, pan = 0, music = false) {
    const f = mtof(note);
    const car = osc("sine", f, t, decay);
    const mod = osc("sine", f * 3.51, t, decay);
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * 1.4, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.04, t + decay * 0.5);
    mod.connect(idx).connect(car.frequency);
    const e = env(t, 0.003, decay);
    car.connect(e);
    out(e, level, pan, 0.55, music);
  }

  function kick(t: number, level = 0.5) {
    const o = osc("sine", 140, t, 0.45);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    const e = env(t, 0.002, 0.4);
    o.connect(e);
    out(e, level, 0, 0.02);
    const clickF = ctx.createBiquadFilter();
    clickF.type = "highpass";
    clickF.frequency.value = 2500;
    const ce = env(t, 0.001, 0.012);
    noiseSource(t, 0.03).connect(clickF).connect(ce);
    out(ce, level * 0.25, 0, 0);
    // Duck the music under it: the pump.
    pump.gain.setValueAtTime(1, t);
    pump.gain.linearRampToValueAtTime(0.5, t + 0.006);
    pump.gain.linearRampToValueAtTime(1, t + 0.24);
  }

  function clap(t: number, level = 0.12, pan = 0) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (const [dt, a] of [
      [0, 1],
      [0.011, 0.8],
      [0.023, 0.9],
    ] as const) {
      g.gain.setValueAtTime(a, t + dt);
      g.gain.exponentialRampToValueAtTime(0.05, t + dt + 0.01);
    }
    g.gain.setValueAtTime(0.8, t + 0.034);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.22);
    noiseSource(t, 0.25).connect(bp).connect(g);
    out(g, level, pan, 0.35, true);
  }

  function hat(t: number, level = 0.03, pan = 0.2, open = false) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = open ? 6500 : 8000;
    const e = env(t, 0.001, open ? 0.22 : 0.035);
    noiseSource(t, open ? 0.3 : 0.06).connect(hp).connect(e);
    out(e, level, pan, 0.08, true);
  }

  /** A UI tick: band-passed noise a few milliseconds long. */
  function tick(t: number, level = 0.05, freq = 3200, pan = 0, decay = 0.016) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = 2.5;
    const e = env(t, 0.0005, decay);
    noiseSource(t, decay + 0.02).connect(bp).connect(e);
    out(e, level, pan, 0.06);
  }

  /** A key on a good keyboard: a soft thock and a bright tick, slightly varied. */
  function key(t: number, level = 0.05, pan = -0.3, heavy = false) {
    tick(t, level, 2600 + rand() * 1600, pan, heavy ? 0.03 : 0.014);
    const body = osc("sine", heavy ? 180 : 240 + rand() * 60, t, 0.05);
    const e = env(t, 0.001, heavy ? 0.06 : 0.035);
    body.connect(e);
    out(e, level * (heavy ? 0.9 : 0.5), pan, 0);
  }

  /** A trackpad click: press and release. */
  function mouse(t: number, pan = 0) {
    tick(t - 0.01, 0.11, 2300, pan, 0.012);
    tick(t + 0.07, 0.06, 3400, pan, 0.008);
  }

  function whoosh(t: number, dur: number, level = 0.1, from = 300, to = 5000, pan = 0, panTo = pan) {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + dur * 0.55);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
    p.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, panTo)), t + dur);
    noiseSource(t, dur + 0.05).connect(bp).connect(g).connect(p);
    out(p, level, 0, 0.3);
  }

  /** A rising sweep into a hit: noise opening up plus a pitch climbing. */
  function riser(t: number, dur: number, level = 0.1) {
    whoosh(t, dur, level, 200, 9000);
    const o = osc("sawtooth", 220, t, dur);
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(1760, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(6000, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + dur * 0.95);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(lp).connect(g);
    out(g, level * 0.25, 0, 0.3);
  }

  /** A reversed cymbal: noise swelling up to a point. */
  function swell(t: number, dur: number, level = 0.12) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0005, t);
    g.gain.exponentialRampToValueAtTime(1, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    noiseSource(t, dur + 0.05).connect(hp).connect(g);
    out(g, level, 0, 0.4);
  }

  function crash(t: number, level = 0.12) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 4500;
    const e = env(t, 0.002, 2.2);
    noiseSource(t, 2.4).connect(hp).connect(e);
    out(e, level, 0, 0.5);
  }

  /** The floor drops: a falling sub, a thump, a crash. */
  function impact(t: number, level = 0.55) {
    const o = osc("sine", 78, t, 2.4);
    o.frequency.setValueAtTime(78, t);
    o.frequency.exponentialRampToValueAtTime(32, t + 1.6);
    const e = env(t, 0.005, 2.2);
    o.connect(e);
    out(e, level, 0, 0.1);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1100;
    const th = env(t, 0.001, 0.3);
    noiseSource(t, 0.35).connect(lp).connect(th);
    out(th, level * 0.4, 0, 0.3);
    crash(t, level * 0.2);
  }

  /** A word punched in: a low hit, a snap, and a bell. */
  function hit(t: number, note: number) {
    kick(t, 0.42);
    const o = osc("sine", mtof(note - 24), t, 0.5);
    o.frequency.setValueAtTime(mtof(note - 24), t);
    o.frequency.exponentialRampToValueAtTime(mtof(note - 26), t + 0.4);
    const e = env(t, 0.003, 0.45);
    o.connect(e);
    out(e, 0.22, 0, 0.2);
    tick(t, 0.12, 1800, 0, 0.05);
    bell(t, note, 0.05, 1.2);
  }

  /** Glass breaking: a crack, then a spray of tiny inharmonic bells falling. */
  function shatter(t: number) {
    tick(t, 0.22, 4200, 0, 0.08);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 2800;
    const e = env(t, 0.001, 0.6);
    noiseSource(t, 0.7).connect(hp).connect(e);
    out(e, 0.12, 0, 0.5);
    for (let i = 0; i < 34; i++) {
      const at = t + 0.01 + rand() ** 1.6 * 0.9;
      const o = osc("sine", 3000 + rand() * 6000, at, 0.3);
      const pe = env(at, 0.001, 0.08 + rand() * 0.25);
      o.connect(pe);
      out(pe, 0.012 + rand() * 0.012, rand() * 1.6 - 0.8, 0.5);
    }
  }

  /** A soft pop: a sine dropping in pitch, like a bubble surfacing. */
  function pop(t: number, level = 0.08, from = 900, to = 520, pan = 0.3) {
    const o = osc("sine", from, t, 0.12);
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + 0.08);
    const e = env(t, 0.002, 0.1);
    o.connect(e);
    out(e, level, pan, 0.2);
  }

  /** Quick tones: up to start, down to stop or switch off. */
  function chime(t: number, notes: number[], level = 0.06, pan = 0) {
    notes.forEach((n, i) => {
      const at = t + i * 0.075;
      const o = osc("sine", mtof(n), at, 0.3);
      const e = env(at, 0.002, 0.22);
      o.connect(e);
      out(e, level, pan, 0.35);
    });
  }

  function shutter(t: number, level = 1, pan = 0) {
    tick(t, 0.2 * level, 2300, pan, 0.02);
    tick(t + 0.048, 0.15 * level, 1600, pan, 0.03);
    whoosh(t, 0.12, 0.04 * level, 2000, 7000, pan);
  }

  /** The hinge: a small motor's whir rising through the swing, then the latch. */
  function hinge(t: number, dur: number) {
    const o = osc("sawtooth", 70, t, dur);
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(150, t + dur * 0.6);
    o.frequency.linearRampToValueAtTime(110, t + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.15);
    g.gain.setValueAtTime(1, t + dur - 0.2);
    g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(bp).connect(g);
    out(g, 0.05, 0.2, 0.2);
    const air = ctx.createBiquadFilter();
    air.type = "bandpass";
    air.frequency.value = 2400;
    air.Q.value = 0.8;
    const f = ctx.createGain();
    f.gain.setValueAtTime(0, t);
    f.gain.linearRampToValueAtTime(1, t + dur * 0.5);
    f.gain.linearRampToValueAtTime(0, t + dur);
    noiseSource(t, dur).connect(air).connect(f);
    out(f, 0.03, 0.2, 0.3);
    // The latch: two clicks and a low knock as it seats flat.
    tick(t + dur - 0.02, 0.18, 2000, 0.2, 0.02);
    tick(t + dur + 0.05, 0.12, 3000, 0.2, 0.015);
    const k = osc("sine", 120, t + dur - 0.02, 0.15);
    const ke = env(t + dur - 0.02, 0.002, 0.12);
    k.connect(ke);
    out(ke, 0.16, 0.2, 0.1);
  }

  /** A device landing on the floor: a thud tuned to its size. */
  function thud(t: number, i: number, big: boolean) {
    const pan = (i / 4 - 0.5) * 0.9;
    const o = osc("sine", big ? 70 : 95 + i * 6, t, 0.35);
    o.frequency.setValueAtTime(big ? 70 : 95 + i * 6, t);
    o.frequency.exponentialRampToValueAtTime(big ? 42 : 60, t + 0.2);
    const e = env(t, 0.002, 0.3);
    o.connect(e);
    out(e, big ? 0.32 : 0.22, pan, 0.15);
    tick(t, 0.06, 900, pan, 0.04);
  }

  // ── The piece ──────────────────────────────────────────────────────────
  const cycle = [
    chord("D3 A3 E4 F#4 C#5"),
    chord("B2 F#3 A3 D4 E4"),
    chord("G2 D3 F#3 A3 B3"),
    chord("A2 E3 G3 B3 C#4"),
  ];
  const roots = ["D2", "B1", "G1", "A1"].map(m);
  const chordAt = (n: number) => cycle[n % 4]!;
  const rootAt = (n: number) => roots[n % 4]!;

  // I · cold open: a low drone under three hits; a riser into the slam.
  pad(0, cue.slam, chord("D2 A2 D3"), 0.05, [200, 700], 1.2);
  hit(cue.word1, m("D6"));
  hit(cue.word2, m("F#6"));
  hit(cue.word3, m("A6"));
  riser(cue.flare - 0.2, cue.slam - cue.flare + 0.2, 0.14);
  swell(cue.slam - 1.0, 1.0, 0.12);
  impact(cue.slam, 0.6);
  bell(cue.slam, m("D6"), 0.06, 3, -0.2);
  bell(cue.slam + 0.01, m("A5"), 0.05, 3, 0.2);

  /** One bar of groove: kick on every beat, offbeat bass, a 16th arp, hats. */
  function groove(
    n: number,
    o: { claps?: boolean; open?: boolean; arp?: number; bassLevel?: number; kick?: boolean; hats?: number } = {},
  ) {
    const { claps = true, open = false, arp = 0.032, bassLevel = 0.15, kick: k = true, hats = 0.022 } = o;
    const t0 = bar(n);
    const notes = chordAt(n);
    if (k) for (let i = 0; i < 4; i++) kick(t0 + i * BEAT, 0.5);
    if (bassLevel > 0)
      for (let i = 0; i < 4; i++) bass(t0 + i * BEAT + BEAT / 2, rootAt(n) + 12, BEAT * 0.45, bassLevel);
    if (claps) for (const i of [1, 3]) clap(t0 + i * BEAT, 0.13);
    if (hats > 0)
      for (let i = 0; i < 8; i++) hat(t0 + i * (BEAT / 2) + BEAT / 4, hats * (i % 2 ? 1 : 0.7), (rand() - 0.5) * 0.5);
    if (open) for (let i = 0; i < 4; i++) hat(t0 + i * BEAT + BEAT / 2, 0.03, 0.15, true);
    if (arp > 0) {
      const pattern = [0, 2, 4, 2, 1, 3, 4, 3, 0, 2, 4, 2, 1, 3, 4, 3];
      for (let i = 0; i < 16; i++)
        pluck(t0 + (i * BEAT) / 4, notes[pattern[i]!]! + 12, arp * (i % 4 === 0 ? 1 : 0.7), ((i % 8) - 3.5) * 0.12);
    }
    pad(t0, t0 + BAR, notes, 0.035, [1200, 2600], 0.05);
  }

  // The music bus's filter: open, closed down into the sweep and opened by it,
  // dulled for the wall, closed for the pocket, opened into each drop.
  const mf = musicFilter.frequency;
  mf.setValueAtTime(20000, 0);
  mf.setValueAtTime(20000, cue.sweep - 0.6);
  mf.exponentialRampToValueAtTime(900, cue.sweep - 0.05);
  mf.exponentialRampToValueAtTime(20000, cue.sweep + 0.9);
  mf.setValueAtTime(20000, cue.stageOut);
  mf.exponentialRampToValueAtTime(2200, cue.wall + 0.5);
  mf.setValueAtTime(2200, cue.wallOut - 1);
  mf.exponentialRampToValueAtTime(20000, cue.back);
  mf.setValueAtTime(20000, cue.qr - 0.05);
  mf.exponentialRampToValueAtTime(1400, cue.qr + 0.6);
  mf.setValueAtTime(1400, cue.qrOut - 1.4);
  mf.exponentialRampToValueAtTime(20000, cue.mark);

  // II–IV · from the slam through the Stage and the console: the groove.
  for (let n = 2; n < 11; n++) groove(n, { claps: n >= 3, open: n >= 7, arp: n >= 3 ? 0.03 : 0.022 });

  // V · the wall: half-time, no hats, room for the landings and the hinge.
  for (let n = 11; n < 16; n++) {
    const t0 = bar(n);
    kick(t0, 0.48);
    kick(t0 + BEAT * 2.5, 0.38);
    clap(t0 + BEAT * 2, 0.11);
    for (let i = 0; i < 4; i++) bass(t0 + i * BEAT + BEAT / 2, rootAt(n) + 12, BEAT * 0.4, 0.11);
    pad(t0, t0 + BAR, chordAt(n), 0.045, [800, 1800], 0.2);
  }
  riser(cue.wallOut - 1, 1, 0.12);
  swell(cue.back - 0.8, 0.8, 0.14);

  // VI · the terminal: the drop.
  impact(cue.back, 0.4);
  for (let n = 16; n < 23; n++) groove(n, { open: true, arp: 0.034, bassLevel: 0.17, hats: 0.026 });

  // VII · pocket: drums out, the arp alone and filtered, sparkles as the code condenses.
  for (let n = 23; n < 25; n++) groove(n, { claps: false, kick: false, bassLevel: 0, hats: 0, arp: 0.026 });
  for (let i = 0; i < 30; i++)
    bell(cue.qr + 0.25 + rand() * 1.4, m("A6") + [0, 2, 4, 7, 9, 12][Math.floor(rand() * 6)]!, 0.012, 0.6, rand() * 1.4 - 0.7);
  riser(cue.mark - BAR, BAR, 0.13);
  swell(cue.mark - 1, 1, 0.14);

  // VIII · the wordmark: an impact on the downbeat, two bars of groove, then the chord rings out.
  impact(cue.mark, 0.62);
  chord("A5 F#5 E5 D5").forEach((n, i) => bell(cue.mark + i * BEAT * (i === 3 ? 1.5 : 1), n, 0.06, 3.5, i % 2 ? 0.25 : -0.25));
  for (let n = 25; n < 27; n++) groove(n, { open: true, arp: 0.03 });
  groove(27, { claps: false, arp: 0.022, hats: 0.014 });
  pad(bar(28), cue.end, chord("D3 A3 E4 F#4 A4 C#5"), 0.07, [1400, 2400], 0.3);
  bell(bar(28), m("D6"), 0.05, 5, -0.1);
  bell(bar(28), m("A5"), 0.04, 5, 0.1);

  // ── Sound to picture ───────────────────────────────────────────────────
  // II · the window closes in, holds, breaks; the device unlocks and glides.
  whoosh(cue.window - 0.15, 0.4, 0.07, 3000, 600);
  bell(cue.window, m("E7"), 0.02, 0.8, 0.2);
  swell(cue.shatter - 0.45, 0.45, 0.08);
  shatter(cue.shatter);
  whoosh(cue.unlock, 0.45, 0.07, 600, 5200);
  whoosh(cue.glide, 0.6, 0.05, 300, 1800, 0, -0.5);

  // III · the Stage assembles, panel by panel, from its side.
  whoosh(cue.stage - 0.1, 0.5, 0.06, 2400, 400);
  for (const [at, pan] of [
    [cue.toolbar, 0],
    [cue.navigator, -0.8],
    [cue.inspector, 0.8],
    [cue.dock, 0],
  ] as const) {
    whoosh(at - 0.12, 0.45, 0.06, 300, 2600, pan);
    tick(at + 0.28, 0.05, 1200, pan, 0.03);
  }
  const clickPan = [635, 967, 730, 760, 731, 687].map((x) => (x / 1440 - 0.5) * 1.2);
  CLICKS.forEach((at, i) => mouse(at, clickPan[i]));
  chime(cue.appearance + 0.03, [m("A5"), m("E5")], 0.05, -0.1);
  bell(cue.palette, m("E7"), 0.025, 0.7, 0.2);
  whoosh(cue.palette - 0.02, 0.25, 0.04, 4000, 1500, 0.2);
  for (const t of PALETTE_KEYS) key(t, 0.06, 0.15);
  key(cue.paletteRun - 0.02, 0.08, 0.15, true);
  whoosh(cue.sweep - 0.05, 1.0, 0.12, 6000, 300, 0.4, -0.4);
  bell(cue.sweep, m("F#6"), 0.03, 1.6, 0.3);
  // Recording: a start chime, a red pulse on the beat, a stop.
  chime(cue.record + 0.02, [m("D5"), m("A5")], 0.07, 0);
  for (let t = cue.record + BEAT; t < cue.stop - 0.05; t += BEAT) {
    const o = osc("sine", mtof(m("D4")), t, 0.25);
    const e = env(t, 0.01, 0.2);
    o.connect(e);
    out(e, 0.03, 0, 0.2);
  }
  tick(cue.tapSettings, 0.08, 1500, 0.1, 0.03);
  whoosh(cue.tapSettings + 0.04, 0.4, 0.05, 500, 4000, 0.1);
  chime(cue.stop + 0.02, [m("A5"), m("D5")], 0.06, 0.05);
  for (const toast of TOASTS) pop(toast.at, 0.07, 1000, 560, 0.45);
  shutter(cue.screenshot + 0.01, 1, -0.05);

  // IV · the console: ⌘J, the drawer, a tick per log line, a tab, the AX pass.
  for (const k of KEYS) {
    key(k.at, 0.07, 0, true);
    key(k.at + 0.09, 0.07, 0.05, true);
  }
  whoosh(cue.console - 0.08, 0.45, 0.07, 300, 2400);
  for (const t of CONSOLE_LOG_TIMES) tick(t, 0.025, 5200 + rand() * 1800, (rand() - 0.5) * 0.6, 0.01);
  mouse(cue.axTab, 0);
  const scale = chord("D6 E6 F#6 A6 B6 D7 E7 F#7 A7 B7 D8");
  axNodes.forEach((_, i) => {
    const t = firstTime((tt) => consoleAx(tt) * 1.7 - i * 0.045 > 0, cue.axTab, cue.axTab + 3);
    bell(t, scale[i % scale.length]!, 0.016, 0.5, 0.1);
  });
  for (let t = cue.axTab + 1.2, prev = -1; t < cue.stageOut - 0.3; t += 0.02) {
    const h = consoleHot(t);
    if (h !== prev && h >= 0) tick(t, 0.02, 2800, 0.1, 0.008);
    prev = h;
  }
  // Out: every panel flung off to its side.
  whoosh(cue.stageOut - 0.05, 0.45, 0.08, 1800, 300, 0, -0.9);
  whoosh(cue.stageOut - 0.02, 0.45, 0.08, 1800, 300, 0, 0.9);

  // V · the wall: a thud per landing, a note per device; the hinge.
  wallLandings().forEach(({ t, id }, i) => {
    thud(t - 0.02, i, id === "ipad");
    bell(t, chord("D5 F#5 A5 C#6 E6")[i]!, 0.04, 1.2, (i / 4 - 0.5) * 0.9);
  });
  whoosh(cue.wallLine - 0.1, 0.5, 0.04, 800, 3000);
  for (const t of keyTimes(commands.hinge.text, commands.hinge.at)) key(t, 0.045, 0.05);
  key(land(commands.hinge) - 0.05, 0.08, 0.05, true);
  hinge(land(commands.hinge), HINGE_DUR);
  bell(land(commands.hinge) + HINGE_DUR, m("A6"), 0.04, 2.2, 0.05);
  bell(land(commands.hinge) + HINGE_DUR, m("D6"), 0.04, 2.2, -0.05);
  for (let i = 0; i < 5; i++) whoosh(cue.wallOut + i * 0.08, 0.35, 0.035, 1500, 250, (i / 4 - 0.5) * 1.2);

  // VI · the terminal: keys, returns, a tap, a scan, shutters.
  whoosh(cue.terminal - 0.05, 0.5, 0.06, 400, 3000, -0.4);
  for (const c of [commands.tap, commands.ax, commands.shot, commands.loop, commands.loopBody]) {
    for (const t of keyTimes(c.text, c.at)) key(t, 0.05, -0.35);
    key(land(c) - 0.05, 0.08, -0.35, true);
  }
  tick(land(commands.tap), 0.09, 1500, 0.4, 0.03);
  whoosh(land(commands.tap) + 0.04, 0.45, 0.05, 600, 4200, 0.4);
  AX_TIMES.forEach((t, i) => bell(t, scale[i % scale.length]!, 0.017, 0.6, 0.4));
  shutter(land(commands.shot), 1, 0.4);
  whoosh(land(commands.shot) + 0.2, 0.9, 0.06, 2600, 500, 0.4, -0.4);
  pop(land(commands.shot) + 1.1, 0.06, 760, 480, -0.4);
  LOOP_SHOTS.forEach((_, i) => {
    shutter(loopShotAt(i), 0.8, -0.4 + i * 0.1);
    pop(loopShotAt(i) + 0.04, 0.045, 700 + i * 120, 450 + i * 80, -0.35);
  });
  whoosh(cue.terminalOut, 0.4, 0.06, 2000, 300);

  // VIII · the install line types itself.
  for (const t of INSTALL_KEYS) key(t, 0.04, 0.1);

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
