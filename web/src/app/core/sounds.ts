// Small synthesized UI sounds, so the app ships no audio files.
// Soft, rounded "bloops" in the spirit of Discord's sounds without copying them: sine voices
// that slide quickly into pitch, a faint octave for warmth and a touch of room reverb.

let ctx: AudioContext | null = null;
let bus: AudioNode | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Shared output: dry signal plus a short generated reverb, through a compressor so stacked notes don't clip. */
function output(ac: AudioContext): AudioNode {
  if (bus) return bus;
  const dry = ac.createGain();
  const comp = ac.createDynamicsCompressor();
  dry.connect(comp).connect(ac.destination);
  const len = Math.floor(ac.sampleRate * 0.45);
  const ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  const verb = ac.createConvolver();
  verb.buffer = ir;
  const wet = ac.createGain();
  wet.gain.value = 0.16;
  dry.connect(verb).connect(wet).connect(comp);
  return (bus = dry);
}

interface Note {
  /** Pitch the note settles on (Hz). */
  f: number;
  /** Pitch it slides from, for the "bloop". */
  from?: number;
  /** Start, in seconds after the sound begins. */
  at?: number;
  /** Seconds until it fades out. */
  len?: number;
  gain?: number;
  type?: OscillatorType;
  /** Level of an added octave, for a rounder, warmer tone. */
  octave?: number;
}

function play(notes: Note[]) {
  const ac = audio();
  if (!ac) return;
  const out = output(ac);
  const t0 = ac.currentTime + 0.01;
  for (const n of notes) {
    const start = t0 + (n.at ?? 0);
    const len = n.len ?? 0.18;
    const env = ac.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(n.gain ?? 0.08, start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, start + len);
    env.connect(out);
    const voices: [number, number][] = n.octave ? [[1, 1], [2, n.octave]] : [[1, 1]];
    for (const [mult, level] of voices) {
      const osc = ac.createOscillator();
      osc.type = n.type ?? 'sine';
      osc.frequency.setValueAtTime((n.from ?? n.f) * mult, start);
      if (n.from) osc.frequency.exponentialRampToValueAtTime(n.f * mult, start + Math.min(0.05, len / 2));
      const g = ac.createGain();
      g.gain.value = level;
      osc.connect(g).connect(env);
      osc.start(start);
      osc.stop(start + len + 0.02);
    }
  }
}

export const sounds = {
  message: () =>
    play([
      { f: 1174.66, from: 1046.5, len: 0.14, gain: 0.06, octave: 0.12 },
      { f: 1567.98, from: 1396.91, at: 0.075, len: 0.32, gain: 0.06, octave: 0.12 },
    ]),
  join: () =>
    play([
      { f: 587.33, from: 440, len: 0.14, octave: 0.22 },
      { f: 880, from: 698.46, at: 0.09, len: 0.3, octave: 0.22 },
    ]),
  leave: () =>
    play([
      { f: 783.99, from: 880, len: 0.14, octave: 0.22 },
      { f: 440, from: 587.33, at: 0.09, len: 0.32, octave: 0.22 },
    ]),
  mute: () => play([{ f: 329.63, from: 523.25, len: 0.1, type: 'triangle', gain: 0.09 }]),
  unmute: () => play([{ f: 523.25, from: 329.63, len: 0.1, type: 'triangle', gain: 0.09 }]),
  deafen: () =>
    play([
      { f: 440, from: 587.33, len: 0.08, type: 'triangle', gain: 0.08 },
      { f: 261.63, from: 392, at: 0.07, len: 0.14, type: 'triangle', gain: 0.08 },
    ]),
  undeafen: () =>
    play([
      { f: 392, from: 261.63, len: 0.08, type: 'triangle', gain: 0.08 },
      { f: 587.33, from: 440, at: 0.07, len: 0.14, type: 'triangle', gain: 0.08 },
    ]),
  /** Someone in the call went live / stopped streaming. */
  streamStart: () =>
    play([
      { f: 587.33, from: 523.25, len: 0.16, gain: 0.06, octave: 0.3 },
      { f: 880, from: 783.99, at: 0.07, len: 0.16, gain: 0.06, octave: 0.3 },
      { f: 1174.66, from: 1046.5, at: 0.14, len: 0.34, gain: 0.06, octave: 0.3 },
    ]),
  streamEnd: () =>
    play([
      { f: 1174.66, from: 1318.51, len: 0.16, gain: 0.06, octave: 0.3 },
      { f: 880, from: 987.77, at: 0.07, len: 0.16, gain: 0.06, octave: 0.3 },
      { f: 587.33, from: 659.25, at: 0.14, len: 0.34, gain: 0.06, octave: 0.3 },
    ]),
  /** You started / stopped watching a stream, or someone did on yours. */
  streamJoin: () =>
    play([
      { f: 987.77, from: 880, len: 0.12, gain: 0.05 },
      { f: 1318.51, from: 1174.66, at: 0.06, len: 0.24, gain: 0.05 },
    ]),
  streamLeave: () =>
    play([
      { f: 1318.51, from: 1479.98, len: 0.12, gain: 0.05 },
      { f: 987.77, from: 1108.73, at: 0.06, len: 0.24, gain: 0.05 },
    ]),
  /** Incoming call; repeated every 2.5 s while it rings. */
  ring: () =>
    play([
      { f: 659.25, from: 622.25, len: 0.22, octave: 0.3 },
      { f: 830.61, at: 0.14, len: 0.22, octave: 0.3 },
      { f: 987.77, at: 0.28, len: 0.22, octave: 0.3 },
      { f: 830.61, at: 0.42, len: 0.5, octave: 0.3 },
    ]),
  unlock: () => audio(),
};
