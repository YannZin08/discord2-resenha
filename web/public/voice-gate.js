// AudioWorklet that decides when the microphone is "open", like Discord's input modes:
// voice activity (manual or automatic sensitivity) or push-to-talk with a release delay.
// It runs on the audio thread, so it keeps working while the tab is in the background.
//
// The audio goes out LOOKAHEAD late while the level is measured on the fresh input, so the
// gate is already open when the first syllable arrives (no clipped starts of words). It opens
// fast and closes with a short fade, so the ends of words don't get chopped either.

const LOOKAHEAD = 0.02; // s
const ATTACK = 0.005; // s, gate opening fade
const RELEASE = 0.06; // s, gate closing fade
const VAD_HOLD = 0.35; // s the gate stays open after the voice drops below the threshold

class VoiceGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.mode = 'vad'; // 'vad' | 'ptt' | 'open'
    this.auto = true;
    this.threshold = -50; // dB, manual sensitivity
    this.ptt = false;
    this.releaseMs = 20;
    this.floor = -70; // estimated noise floor for automatic sensitivity
    this.gain = 0;
    this.holdUntil = 0;
    this.blocks = 0;
    // Delay line for the look-ahead, one per channel.
    this.delay = Math.max(1, Math.round(sampleRate * LOOKAHEAD));
    this.rings = [];
    this.pos = 0;
    // Speaking indicator: on after a few voiced blocks (~10 ms, so a click doesn't light it),
    // off shortly after the voice stops; only while the gate is actually letting audio out.
    this.voiced = 0;
    this.voiceUntil = 0;
    this.speaking = false;
    this.port.onmessage = (e) => Object.assign(this, e.data);
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true;

    let sum = 0;
    let n = 0;
    for (const ch of input) {
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      n += ch.length;
    }
    const db = n ? 10 * Math.log10(sum / n + 1e-12) : -100;

    // Noise floor follows quiet parts quickly and loud parts very slowly.
    this.floor += (db - this.floor) * (db < this.floor ? 0.05 : 0.0008);
    const autoThreshold = Math.min(-25, Math.max(-65, this.floor + 14));
    const threshold = this.auto ? autoThreshold : this.threshold;

    const want = this.mode === 'open' || (this.mode === 'ptt' ? this.ptt : db > threshold);
    if (want) this.holdUntil = currentTime + (this.mode === 'ptt' ? this.releaseMs / 1000 : VAD_HOLD);
    const open = want || currentTime < this.holdUntil;

    const target = open ? 1 : 0;
    const up = 1 / (sampleRate * ATTACK);
    const down = 1 / (sampleRate * RELEASE);
    const len = input[0].length;
    for (let c = 0; c < output.length; c++) {
      if (!this.rings[c]) this.rings[c] = new Float32Array(this.delay);
    }
    let pos = this.pos;
    let gain = this.gain;
    for (let i = 0; i < len; i++) {
      gain += target > gain ? Math.min(up, target - gain) : -Math.min(down, gain - target);
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0];
        const ring = this.rings[c];
        const late = ring[pos];
        ring[pos] = src[i];
        output[c][i] = late * gain;
      }
      pos = pos + 1 === this.delay ? 0 : pos + 1;
    }
    this.pos = pos;
    this.gain = gain;

    // With push-to-talk or an always-open mic the gate says nothing about voice, so the
    // indicator uses the automatic threshold there.
    const voice = db > (this.mode === 'vad' ? threshold : autoThreshold);
    this.voiced = voice ? this.voiced + 1 : 0;
    if (this.voiced >= 4) this.voiceUntil = currentTime + 0.2;
    const speaking = open && currentTime < this.voiceUntil;

    const tick = this.blocks++ % 16 === 0;
    if (speaking !== this.speaking || tick) {
      this.speaking = speaking;
      this.port.postMessage({ db, threshold, open, speaking });
    }
    return true;
  }
}

registerProcessor('voice-gate', VoiceGate);
