import { Component, OnDestroy, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MicLevel, MicPipeline } from '../../core/mic';
import { MicSettings, Prefs } from '../../core/prefs';
import { Ui } from '../../core/ui';
import { Voice } from '../../core/voice';

/** Readable name for a KeyboardEvent.code, e.g. "KeyV" → "V". */
function keyLabel(code: string | null): string {
  if (!code) return 'Nenhum atalho';
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Numpad/, 'Num ')
    .replace(/Left$|Right$/, (m) => (m === 'Left' ? ' esq.' : ' dir.'))
    .replace('Backquote', "'")
    .replace('Space', 'Espaço')
    .replace('CapsLock', 'Caps Lock');
}

/** Discord's "Voz e vídeo" screen: devices, volumes, input mode, sensitivity, voice processing. */
@Component({
  selector: 'app-voice-settings',
  imports: [FormsModule],
  template: `
    @let m = mic();
    <h2>Configurações de voz</h2>
    <div class="two-col">
      <div>
        <label class="field-label">Dispositivo de entrada</label>
        <select class="input" [ngModel]="prefs.data().inputDevice" (ngModelChange)="changeInput($event)">
          <option value="default">Padrão</option>
          @for (d of inputs(); track d.deviceId) {
            <option [value]="d.deviceId">{{ d.label || 'Microfone' }}</option>
          }
        </select>
      </div>
      <div>
        <label class="field-label">Dispositivo de saída</label>
        <select class="input" [ngModel]="prefs.data().outputDevice" (ngModelChange)="voice.changeOutputDevice($event)">
          <option value="default">Padrão</option>
          @for (d of outputs(); track d.deviceId) {
            <option [value]="d.deviceId">{{ d.label || 'Alto-falante' }}</option>
          }
        </select>
      </div>
      <div>
        <label class="field-label">Volume de entrada</label>
        <div class="vol-row">
          <input type="range" min="0" max="200" [value]="m.inputVolume" (input)="set({ inputVolume: +$any($event.target).value })" />
          <span>{{ m.inputVolume }}%</span>
        </div>
      </div>
      <div>
        <label class="field-label">Volume de saída</label>
        <div class="vol-row">
          <input type="range" min="0" max="100" [value]="prefs.data().outputVolume" (input)="setOutput(+$any($event.target).value)" />
          <span>{{ prefs.data().outputVolume }}%</span>
        </div>
      </div>
    </div>

    <label class="field-label">Teste de microfone</label>
    <p class="hint">Está com problemas no microfone? Comece um teste e diga alguma coisa: vamos reproduzir sua voz para você.</p>
    <div class="mic-test">
      <button class="btn btn-brand" (click)="toggleTest()">{{ testing() ? 'Parar teste' : 'Vamos verificar' }}</button>
      <div class="mic-meter">
        @for (i of meterBars; track i) {
          <span [class.on]="meterOn(i)"></span>
        }
      </div>
    </div>

    <div class="settings-divider"></div>
    <label class="field-label">Modo de entrada</label>
    <label class="radio-card" [class.active]="m.mode === 'vad'">
      <input type="radio" name="mode" [checked]="m.mode === 'vad'" (change)="set({ mode: 'vad' })" />
      <div><div class="rc-title">Detecção de voz</div></div>
    </label>
    <label class="radio-card" [class.active]="m.mode === 'ptt'">
      <input type="radio" name="mode" [checked]="m.mode === 'ptt'" (change)="set({ mode: 'ptt' })" />
      <div><div class="rc-title">Pressione para falar</div></div>
    </label>

    @if (m.mode === 'ptt') {
      <div class="two-col">
        <div>
          <label class="field-label">Atalho</label>
          <button class="keybind" [class.recording]="recording()" (click)="recordKey()">
            <span>{{ recording() ? 'Pressione uma tecla...' : keyName() }}</span>
            <strong>{{ recording() ? 'Parar' : m.pttKey ? 'Editar atalho' : 'Gravar atalho' }}</strong>
          </button>
          @if (!m.pttKey) {
            <p class="add-msg error">Grave um atalho: sem ele o microfone fica fechado.</p>
          }
        </div>
        <div>
          <label class="field-label">Atraso para soltar o "pressione para falar"</label>
          <div class="vol-row">
            <input type="range" min="0" max="2000" step="10" [value]="m.pttRelease" (input)="set({ pttRelease: +$any($event.target).value })" />
            <span>{{ m.pttRelease }} ms</span>
          </div>
        </div>
      </div>
      <p class="hint">O atalho funciona enquanto a janela do app está em foco. {{ voice.pttDown() ? 'Falando...' : '' }}</p>
    } @else {
      <label class="field-label">Sensibilidade de entrada</label>
      <label class="toggle-row compact">
        <div class="toggle-title">Determinar automaticamente a sensibilidade de entrada</div>
        <input type="checkbox" class="switch" [checked]="m.autoSensitivity" (change)="set({ autoSensitivity: $any($event.target).checked })" />
      </label>
      <div class="sens-meter" [class.manual]="!m.autoSensitivity">
        <div class="sens-fill" [class.open]="level().open" [style.width.%]="pct(level().db)"></div>
        <div class="sens-threshold" [style.left.%]="pct(m.autoSensitivity ? level().threshold : m.sensitivity)"></div>
        @if (!m.autoSensitivity) {
          <input type="range" min="-100" max="0" [value]="m.sensitivity" (input)="set({ sensitivity: +$any($event.target).value })" />
        }
      </div>
      <p class="hint">
        @if (m.autoSensitivity) {
          A sensibilidade se ajusta sozinha ao ruído do ambiente.
        } @else {
          Arraste a marca: o microfone só abre quando a barra passa dela ({{ m.sensitivity }} dB).
        }
      </p>
    }

    <div class="settings-divider"></div>
    <h2>Processamento de voz</h2>
    <label class="field-label">Supressão de ruído</label>
    <p class="hint">Remove ruídos de fundo, como teclado, ventilador e barulho da rua.</p>
    <div class="pill-group">
      <button class="pill wide" [class.active]="m.noiseSuppression === 'advanced'" (click)="set({ noiseSuppression: 'advanced' })">
        <strong>Avançada (IA)</strong><span>remove quase todo ruído</span>
      </button>
      <button class="pill wide" [class.active]="m.noiseSuppression === 'standard'" (click)="set({ noiseSuppression: 'standard' })">
        <strong>Padrão</strong><span>a do navegador</span>
      </button>
      <button class="pill wide" [class.active]="m.noiseSuppression === 'none'" (click)="set({ noiseSuppression: 'none' })">
        <strong>Nenhuma</strong><span>som original</span>
      </button>
    </div>
    <label class="toggle-row">
      <div>
        <div class="toggle-title">Cancelamento de eco</div>
        <div class="hint">Evita que os outros ouçam o próprio som voltando pelo seu alto-falante.</div>
      </div>
      <input type="checkbox" class="switch" [checked]="m.echoCancellation" (change)="set({ echoCancellation: $any($event.target).checked })" />
    </label>
    <label class="toggle-row">
      <div>
        <div class="toggle-title">Controle automático de ganho</div>
        <div class="hint">Mantém sua voz num volume constante, mesmo longe do microfone.</div>
      </div>
      <input type="checkbox" class="switch" [checked]="m.autoGain" (change)="set({ autoGain: $any($event.target).checked })" />
    </label>
    @if (restarting()) {
      <p class="hint">Reiniciando o microfone com as novas configurações...</p>
    }

    <div class="settings-divider"></div>
    <h2>Configurações de vídeo</h2>
    <label class="field-label">Câmera</label>
    <select class="input" [ngModel]="prefs.data().videoDevice" (ngModelChange)="prefs.set('videoDevice', $event)">
      <option value="default">Padrão</option>
      @for (d of cameras(); track d.deviceId) {
        <option [value]="d.deviceId">{{ d.label || 'Câmera' }}</option>
      }
    </select>
  `,
})
export class VoiceSettings implements OnDestroy {
  readonly prefs = inject(Prefs);
  readonly voice = inject(Voice);
  private ui = inject(Ui);
  readonly meterBars = Array.from({ length: 40 }, (_, i) => i);
  readonly devices = signal<MediaDeviceInfo[]>([]);
  readonly inputs = computed(() => this.devices().filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'));
  readonly outputs = computed(() => this.devices().filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'));
  readonly cameras = computed(() => this.devices().filter((d) => d.kind === 'videoinput'));
  readonly mic = computed(() => this.prefs.data().mic);
  readonly keyName = computed(() => keyLabel(this.mic().pttKey));
  readonly testing = signal(false);
  readonly recording = signal(false);
  readonly restarting = signal(false);

  /** Outside a call, the screen runs its own preview of the mic so the meter is live. */
  private preview: MicPipeline | null = null;
  private previewLevel = signal<MicLevel>({ db: -100, threshold: -50, open: false });
  readonly level = computed(() => this.voice.micLevel() ?? this.previewLevel());
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor() {
    void this.init();
    // Push-to-talk presses reach the preview too.
    effect(() => {
      const down = this.voice.pttDown();
      untracked(() => this.preview?.setPtt(down));
    });
  }

  private async init() {
    await this.ensurePreview();
    try {
      this.devices.set(await navigator.mediaDevices.enumerateDevices());
    } catch {
      // no device list
    }
  }

  private async ensurePreview() {
    if (this.voice.active() || this.preview) return;
    try {
      this.preview = await MicPipeline.create(this.prefs.get('inputDevice'), this.mic());
      this.preview.onLevel = (l) => this.previewLevel.set({ ...l });
    } catch {
      this.ui.toast('Não foi possível acessar o microfone.', 'error');
    }
  }

  private async restartPreview() {
    if (!this.preview) return;
    const monitoring = this.testing();
    this.preview.destroy();
    this.preview = null;
    await this.ensurePreview();
    // ensurePreview() just set it again; TypeScript can't see that through the await.
    (this.preview as MicPipeline | null)?.monitor(monitoring);
  }

  ngOnDestroy() {
    this.preview?.destroy();
    this.preview = null;
    this.stopRecording();
  }

  async set(patch: Partial<MicSettings>) {
    const prev = this.mic();
    const next = { ...prev, ...patch };
    const restart = MicPipeline.needsRestart(prev, next);
    if (restart) this.restarting.set(true);
    await this.voice.updateMicSettings(next);
    if (this.preview) {
      if (restart) await this.restartPreview();
      else this.preview.update(next);
    }
    this.restarting.set(false);
  }

  setOutput(v: number) {
    this.prefs.set('outputVolume', v);
    this.voice.changeOutputDevice(this.prefs.get('outputDevice'));
  }

  async changeInput(deviceId: string) {
    await this.voice.changeInputDevice(deviceId);
    await this.restartPreview();
  }

  async toggleTest() {
    if (this.voice.active() && !this.preview) {
      this.ui.toast('Saia da chamada para fazer o teste de microfone.', 'info');
      return;
    }
    await this.ensurePreview();
    const on = !this.testing();
    this.testing.set(on);
    this.preview?.monitor(on);
  }

  recordKey() {
    if (this.recording()) return this.stopRecording();
    this.recording.set(true);
    this.keyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') void this.set({ pttKey: e.code });
      this.stopRecording();
    };
    window.addEventListener('keydown', this.keyHandler, { capture: true });
  }

  private stopRecording() {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler, { capture: true });
    this.keyHandler = null;
    this.recording.set(false);
  }

  /** -100..0 dB mapped to 0..100 %. */
  pct(db: number) {
    return Math.max(0, Math.min(100, db + 100));
  }

  meterOn(i: number) {
    return this.pct(this.level().db) > (i / this.meterBars.length) * 100 && this.level().open;
  }
}
