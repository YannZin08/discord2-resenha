// AudioWorklet that decides when the microphone is "open", like Discord's input modes:
// voice activity (manual or automatic sensitivity) or push-to-talk with a release delay.
// It runs on the audio thread, so it keeps working while the tab is in the background.

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
    if (want) this.holdUntil = currentTime + (this.mode === 'ptt' ? this.releaseMs / 1000 : 0.3);
    const open = want || currentTime < this.holdUntil;

    // 10 ms ramp avoids clicks when the gate opens or closes.
    const target = open ? 1 : 0;
    const step = 1 / (sampleRate * 0.01);
    const len = input[0].length;
    for (let i = 0; i < len; i++) {
      this.gain += Math.max(-step, Math.min(step, target - this.gain));
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0];
        output[c][i] = src[i] * this.gain;
      }
    }

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
