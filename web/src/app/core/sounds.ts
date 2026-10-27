// Small synthesized UI sounds, so the app ships no audio files.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freqs: number[], step: number, gain = 0.08, type: OscillatorType = 'sine') {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;
  freqs.forEach((f, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = f;
    const start = t0 + i * step;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + step * 1.8);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + step * 2);
  });
}

export const sounds = {
  message: () => tone([880, 1318.5], 0.09, 0.06),
  join: () => tone([523.25, 659.25, 783.99], 0.07, 0.07),
  leave: () => tone([783.99, 659.25, 523.25], 0.07, 0.07),
  mute: () => tone([440, 330], 0.05, 0.05, 'triangle'),
  unmute: () => tone([330, 440], 0.05, 0.05, 'triangle'),
  deafen: () => tone([392, 293.66, 220], 0.05, 0.05, 'triangle'),
  undeafen: () => tone([220, 293.66, 392], 0.05, 0.05, 'triangle'),
  /** Someone in the call went live / stopped streaming. */
  streamStart: () => tone([587.33, 880, 1174.66], 0.06, 0.06, 'triangle'),
  streamEnd: () => tone([1174.66, 880, 587.33], 0.06, 0.06, 'triangle'),
  /** You started / stopped watching a stream, or someone did on yours. */
  streamJoin: () => tone([987.77, 1318.5], 0.06, 0.05),
  streamLeave: () => tone([1318.5, 987.77], 0.06, 0.05),
  ring: () => tone([659.25, 783.99, 659.25, 783.99], 0.12, 0.07),
  unlock: () => audio(),
};
