import { Component, computed, inject, input, model } from '@angular/core';
import { MAX_STREAM, Prefs, StreamSettings } from '../../core/prefs';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { Voice } from '../../core/voice';
import { channelLabel } from '../../core/util';
import { Icon } from '../shared';

const RESOLUTIONS: { value: StreamSettings['resolution']; label: string; sub: string }[] = [
  { value: 'source', label: 'Nativa', sub: 'até 4K' },
  { value: '1440', label: '1440p', sub: 'QHD' },
  { value: '1080', label: '1080p', sub: 'Full HD' },
  { value: '720', label: '720p', sub: 'HD' },
];
const FRAME_RATES: StreamSettings['fps'][] = [60, 30, 15];

/** Resolution / frame rate / priority pickers, shared by the Go Live window and the settings screen. */
@Component({
  selector: 'app-stream-options',
  template: `
    @let s = settings();
    <label class="field-label">Resolução</label>
    <div class="pill-group">
      @for (r of resolutions; track r.value) {
        <button type="button" class="pill" [class.active]="s.resolution === r.value" (click)="set({ resolution: r.value })">
          <strong>{{ r.label }}</strong><span>{{ r.sub }}</span>
        </button>
      }
    </div>
    <label class="field-label">Taxa de quadros</label>
    <div class="pill-group">
      @for (f of frameRates; track f) {
        <button type="button" class="pill" [class.active]="s.fps === f" (click)="set({ fps: f })">
          <strong>{{ f }} FPS</strong>
        </button>
      }
    </div>
    <label class="field-label">Prioridade</label>
    <div class="pill-group">
      <button type="button" class="pill wide" [class.active]="s.priority === 'quality'" (click)="set({ priority: 'quality' })">
        <strong>Nitidez máxima</strong><span>nunca baixa a resolução</span>
      </button>
      <button type="button" class="pill wide" [class.active]="s.priority === 'smooth'" (click)="set({ priority: 'smooth' })">
        <strong>Fluidez</strong><span>para jogos rápidos</span>
      </button>
    </div>
    <label class="toggle-row compact">
      <div>
        <div class="toggle-title">Transmitir o som</div>
        <div class="hint">Áudio da aba, janela ou tela compartilhada.</div>
      </div>
      <input type="checkbox" class="switch" [checked]="s.audio" (change)="set({ audio: $any($event.target).checked })" />
    </label>
    @if (!isMax()) {
      <button type="button" class="btn-link-inline" (click)="settings.set(max)">Voltar para a qualidade máxima (4K, 60 FPS)</button>
    }
    <p class="hint stream-hint">
      A qualidade real depende da sua tela e da sua internet: 4K a 60 FPS usa cerca de 25 Mbps de upload para cada pessoa assistindo.
    </p>
  `,
})
export class StreamOptions {
  readonly settings = model.required<StreamSettings>();
  readonly resolutions = RESOLUTIONS;
  readonly frameRates = FRAME_RATES;
  readonly max = MAX_STREAM;
  readonly isMax = computed(() => {
    const s = this.settings();
    return s.resolution === 'source' && s.fps === 60 && s.priority === 'quality';
  });

  set(patch: Partial<StreamSettings>) {
    this.settings.set({ ...this.settings(), ...patch });
  }
}

@Component({
  selector: 'app-go-live',
  imports: [StreamOptions, Icon],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <div class="modal go-live" role="dialog">
      <button class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
      <div class="modal-body">
        <h2 class="left">Transmitir tela</h2>
        <p class="modal-sub">em {{ where() }}</p>
        <app-stream-options [(settings)]="settings" />
      </div>
      <div class="modal-footer">
        <button class="btn btn-link" (click)="ui.close()">Cancelar</button>
        <button class="btn btn-brand" (click)="go()"><app-icon name="live" [size]="18" /> Ao vivo</button>
      </div>
    </div>
  `,
})
export class GoLive {
  readonly ui = inject(Ui);
  private voice = inject(Voice);
  private prefs = inject(Prefs);
  private store = inject(Store);
  readonly modalId = input<number>();
  settings: StreamSettings = { ...this.prefs.get('stream') };

  readonly where = computed(() => {
    const c = this.store.channels()[this.voice.channelId() ?? 0];
    if (!c) return '';
    return c.guildId != null ? c.name : channelLabel(c, this.store.users(), this.store.me()?.id);
  });

  go() {
    this.ui.close();
    void this.voice.startScreen(this.settings);
  }
}

/** Opens the Go Live window, or stops the stream if already live. */
export function toggleStream(ui: Ui, voice: Voice) {
  if (voice.localScreen()) voice.stopScreenShare();
  else ui.open(GoLive);
}
