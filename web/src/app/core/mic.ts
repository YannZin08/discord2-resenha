import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
import type { MicSettings } from './prefs';

export interface MicLevel {
  db: number;
  threshold: number;
  open: boolean;
  /** Voice is going out right now (drives the green speaking ring). */
  speaking: boolean;
}

let rnnoiseWasm: Promise<ArrayBuffer> | null = null;

/**
 * Microphone → (AI noise suppression) → input volume → voice gate → stream sent to the call.
 * Mirrors Discord's voice processing; the browser's own echo cancellation, noise
 * suppression ("Padrão") and gain control are applied at capture.
 */
export class MicPipeline {
  readonly stream: MediaStream;
  readonly level: MicLevel = { db: -100, threshold: -50, open: false, speaking: false };
  onLevel: ((l: MicLevel) => void) | null = null;

  private constructor(
    private ctx: AudioContext,
    private raw: MediaStream,
    private volume: GainNode,
    private gate: AudioWorkletNode,
    private denoise: RnnoiseWorkletNode | null,
    private dest: MediaStreamAudioDestinationNode,
    private monitorNode: GainNode,
  ) {
    this.stream = dest.stream;
    gate.port.onmessage = (e: MessageEvent<MicLevel>) => {
      Object.assign(this.level, e.data);
      this.onLevel?.(this.level);
    };
  }

  static async create(deviceId: string, s: MicSettings): Promise<MicPipeline> {
    const raw = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId !== 'default' ? { exact: deviceId } : undefined,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression === 'standard',
        autoGainControl: s.autoGain,
        channelCount: 1,
      },
    });
    try {
      // RNNoise works at 48 kHz.
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
      await ctx.audioWorklet.addModule('/voice-gate.js');
      let denoise: RnnoiseWorkletNode | null = null;
      if (s.noiseSuppression === 'advanced') {
        try {
          rnnoiseWasm ??= loadRnnoise({ url: '/noise/rnnoise.wasm', simdUrl: '/noise/rnnoise_simd.wasm' });
          const wasmBinary = await rnnoiseWasm;
          await ctx.audioWorklet.addModule('/noise/rnnoise/workletProcessor.js');
          denoise = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
        } catch (e) {
          console.warn('AI noise suppression unavailable, continuing without it', e);
          rnnoiseWasm = null;
        }
      }
      const source = ctx.createMediaStreamSource(raw);
      const volume = ctx.createGain();
      const gate = new AudioWorkletNode(ctx, 'voice-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      const dest = ctx.createMediaStreamDestination();
      const monitor = ctx.createGain();
      monitor.gain.value = 0;
      (denoise ? source.connect(denoise).connect(volume) : source.connect(volume)).connect(gate);
      gate.connect(dest);
      gate.connect(monitor).connect(ctx.destination);
      const p = new MicPipeline(ctx, raw, volume, gate, denoise, dest, monitor);
      p.update(s);
      return p;
    } catch (e) {
      raw.getTracks().forEach((t) => t.stop());
      throw e;
    }
  }

  /** Settings that apply live, without reopening the microphone. */
  update(s: MicSettings, ptt?: boolean) {
    this.volume.gain.value = s.inputVolume / 100;
    this.gate.port.postMessage({
      mode: s.mode,
      auto: s.autoSensitivity,
      threshold: s.sensitivity,
      releaseMs: s.pttRelease,
      ...(ptt !== undefined ? { ptt } : {}),
    });
  }

  setPtt(down: boolean) {
    this.gate.port.postMessage({ ptt: down });
  }

  /** Plays the processed microphone back to you (Discord's "Vamos verificar"). */
  monitor(on: boolean) {
    this.monitorNode.gain.value = on ? 1 : 0;
  }

  /** Settings that need the microphone reopened. */
  static needsRestart(a: MicSettings, b: MicSettings): boolean {
    return a.noiseSuppression !== b.noiseSuppression || a.echoCancellation !== b.echoCancellation || a.autoGain !== b.autoGain;
  }

  destroy() {
    this.raw.getTracks().forEach((t) => t.stop());
    this.stream.getTracks().forEach((t) => t.stop());
    this.denoise?.destroy();
    this.gate.port.onmessage = null;
    void this.ctx.close().catch(() => undefined);
  }
}
