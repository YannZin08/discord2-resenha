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
    const threshold = this.auto ? Math.min(-25, Math.max(-65, this.floor + 14)) : this.threshold;

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

    if (this.blocks++ % 16 === 0) this.port.postMessage({ db, threshold, open });
    return true;
  }
}

registerProcessor('voice-gate', VoiceGate);
