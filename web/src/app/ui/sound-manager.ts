import { Component, computed, inject, input, signal } from '@angular/core';
import { Api } from '../core/api';
import { emojiSrc } from '../core/custom-emoji';
import { Soundboard } from '../core/soundboard';
import type { Sound } from '../core/types';
import { Ui } from '../core/ui';
import { confirmDialog } from './modals/dialogs';
import { Icon } from './shared';
import { Tip } from './tooltip';

/** Most a sound can weigh (the server checks it too). */
const MAX_SOUND = 5 * 1024 * 1024;

/** Some systems give no type for audio files; the server only takes audio/*. */
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  webm: 'audio/webm',
};

function pickAudio(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'audio/*,.mp3,.ogg,.opus,.wav,.m4a,.aac,.flac';
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
}

/**
 * Upload, rename, set the emoji/volume of and delete soundboard sounds. Used for a server's
 * sounds (server settings) and someone's own (user settings): `path` is
 * "/guilds/:id/sounds" or "/users/@me/sounds".
 */
@Component({
  selector: 'app-sound-manager',
  imports: [Icon, Tip],
  template: `
    <div class="settings-actions">
      <button class="btn btn-brand" [disabled]="busy()" (click)="upload()">
        {{ busy() ? 'Enviando ' + busy() + '...' : 'Enviar som' }}
      </button>
    </div>
    <p class="hint">MP3, OGG, WAV, M4A ou outro áudio de até 5 MB. Dá para escolher vários arquivos de uma vez; o nome vem do arquivo.</p>
    @if (sounds().length) {
      <h3 class="settings-h3">{{ count() }}</h3>
      <div class="sound-table">
        @for (s of sounds(); track s.id) {
          <div class="sound-row">
            <button class="sound-row-emoji" appTip="Escolher emoji" (click)="pickEmoji(s, $event)">
              @if (s.emoji) {
                <img [src]="emoji(s.emoji)" alt="" />
              } @else {
                <app-icon name="soundboard" [size]="18" />
              }
            </button>
            <input
              class="input sound-row-name"
              maxlength="32"
              [value]="s.name"
              (keydown.enter)="$any($event.target).blur()"
              (blur)="rename(s, $any($event.target))"
              aria-label="Nome do som"
            />
            <label class="sound-row-vol" appTip="Volume do som">
              <input type="range" min="0" max="100" [value]="s.volume" (change)="setVolume(s, +$any($event.target).value)" />
              <span>{{ s.volume }}%</span>
            </label>
            <button class="icon-btn" [appTip]="board.playing().has(s.id) ? 'Parar' : 'Ouvir'" (click)="board.preview(s)">
              <app-icon [name]="board.playing().has(s.id) ? 'stop' : 'play'" [size]="18" />
            </button>
            @if (s.emoji) {
              <button class="icon-btn" appTip="Tirar emoji" (click)="patch(s, { emoji: null })"><app-icon name="close" [size]="16" /></button>
            }
            <button class="icon-btn emoji-row-del" appTip="Excluir som" aria-label="Excluir som" (click)="remove(s)">
              <app-icon name="trash" [size]="18" />
            </button>
          </div>
        }
      </div>
    } @else {
      <div class="emoji-empty">
        <span>🔇</span>
        <p>{{ empty() }}</p>
      </div>
    }
  `,
})
export class SoundManager {
  readonly path = input.required<string>();
  readonly sounds = input.required<Sound[]>();
  readonly empty = input('Nenhum som ainda. Envie o primeiro!');
  readonly board = inject(Soundboard);
  private api = inject(Api);
  private ui = inject(Ui);
  readonly busy = signal('');

  readonly count = computed(() => {
    const n = this.sounds().length;
    return `${n} ${n === 1 ? 'som' : 'sons'}`;
  });

  emoji(e: string) {
    return emojiSrc(e);
  }

  /** "Risada do Faustão.mp3" → "Risada do Faustão". */
  private nameFor(file: File): string {
    const name = file.name
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 32)
      .trim();
    return name || 'Som';
  }

  async upload() {
    const files = await pickAudio();
    if (!files.length) return;
    let done = 0;
    for (const [i, f] of files.entries()) {
      this.busy.set(files.length > 1 ? `${i + 1} de ${files.length}` : 'som');
      try {
        if (f.size > MAX_SOUND) throw new Error(`"${f.name}" passa de 5 MB. Escolha um áudio menor.`);
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        const type = f.type.startsWith('audio/') ? f.type : AUDIO_TYPES[ext];
        if (!type) throw new Error(`"${f.name}" não é um arquivo de áudio.`);
        const { key } = await this.api.upload(new Blob([f], { type }), f.name);
        await this.api.post(this.path(), { name: this.nameFor(f), file: key });
        done++;
      } catch (e) {
        this.ui.error(e);
      }
    }
    this.busy.set('');
    if (done) this.ui.toast(done === 1 ? 'Som adicionado.' : `${done} sons adicionados.`, 'success');
  }

  patch(s: Sound, body: Partial<Sound>) {
    this.api.patch(`${this.path()}/${s.id}`, body).catch((err) => this.ui.error(err));
  }

  rename(s: Sound, input: HTMLInputElement) {
    const name = input.value.trim();
    if (name === s.name) return;
    this.api.patch(`${this.path()}/${s.id}`, { name }).catch((err) => {
      input.value = s.name;
      this.ui.error(err);
    });
  }

  setVolume(s: Sound, volume: number) {
    if (volume !== s.volume) this.patch(s, { volume });
  }

  pickEmoji(s: Sound, e: MouseEvent) {
    this.ui.openPicker(e.currentTarget as Element, (emoji) => this.patch(s, { emoji }));
  }

  async remove(s: Sound) {
    const ok = await confirmDialog(this.ui, {
      title: 'Excluir som',
      body: `Excluir "${s.name}"? Ele some do painel de efeitos sonoros de todo mundo.`,
      confirmText: 'Excluir',
      danger: true,
    });
    if (ok) this.api.delete(`${this.path()}/${s.id}`).catch((err) => this.ui.error(err));
  }
}
