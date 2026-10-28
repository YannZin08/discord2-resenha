import { Component, computed, inject, input, signal } from '@angular/core';
import { Api } from '../core/api';
import { customEmojiUrl } from '../core/custom-emoji';
import type { CustomEmoji } from '../core/types';
import { Ui } from '../core/ui';
import { confirmDialog } from './modals/dialogs';
import { MAX_EMOJI_IMAGE, emojiImage, pickImages } from './modals/image';
import { Icon } from './shared';

/**
 * Upload, rename and delete custom emojis. Used for a server's emojis (server settings) and for
 * someone's own (user settings): `path` is "/guilds/:id/emojis" or "/users/@me/emojis".
 */
@Component({
  selector: 'app-emoji-manager',
  imports: [Icon],
  template: `
    <div class="settings-actions">
      <button class="btn btn-brand" [disabled]="busy()" (click)="upload()">
        {{ busy() ? 'Enviando ' + busy() + '...' : 'Enviar emoji' }}
      </button>
    </div>
    <p class="hint">PNG, JPG, WebP ou GIF de até 2 MB. Dá para escolher vários arquivos de uma vez; o nome vem do arquivo.</p>
    @if (emojis().length) {
      <h3 class="settings-h3">{{ count() }}</h3>
      <div class="emoji-table">
        @for (e of emojis(); track e.id) {
          <div class="emoji-row">
            <img class="emoji-row-img" [src]="url(e.id)" [alt]="e.name" />
            <span class="emoji-row-colon">:</span>
            <input
              class="input emoji-row-name"
              maxlength="32"
              [value]="e.name"
              (keydown.enter)="$any($event.target).blur()"
              (blur)="rename(e, $any($event.target))"
              aria-label="Nome do emoji"
            />
            <span class="emoji-row-colon">:</span>
            @if (e.animated) {
              <span class="emoji-row-tag">GIF</span>
            }
            <button class="icon-btn emoji-row-del" title="Excluir emoji" aria-label="Excluir emoji" (click)="remove(e)">
              <app-icon name="trash" [size]="18" />
            </button>
          </div>
        }
      </div>
    } @else {
      <div class="emoji-empty">
        <span>😶</span>
        <p>{{ empty() }}</p>
      </div>
    }
  `,
})
export class EmojiManager {
  readonly path = input.required<string>();
  readonly emojis = input.required<CustomEmoji[]>();
  readonly empty = input('Nenhum emoji ainda. Envie o primeiro!');
  private api = inject(Api);
  private ui = inject(Ui);
  readonly busy = signal('');

  readonly count = computed(() => {
    const list = this.emojis();
    const animated = list.filter((e) => e.animated).length;
    const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
    return animated ? `${n(list.length, 'emoji', 'emojis')} · ${n(animated, 'animado', 'animados')}` : n(list.length, 'emoji', 'emojis');
  });

  url(id: number) {
    return customEmojiUrl(id);
  }

  /** A free :name: from the file name ("Gato Feliz.gif" → Gato_Feliz, then Gato_Feliz2...). */
  private nameFor(file: File, taken: Set<string>): string {
    let base = file.name
      .replace(/\.[^.]+$/, '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 28);
    if (base.length < 2) base = 'emoji';
    let name = base;
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}${i}`;
    taken.add(name.toLowerCase());
    return name;
  }

  async upload() {
    const files = await pickImages();
    if (!files.length) return;
    const taken = new Set(this.emojis().map((e) => e.name.toLowerCase()));
    let done = 0;
    for (const [i, f] of files.entries()) {
      this.busy.set(files.length > 1 ? `${i + 1} de ${files.length}` : 'emoji');
      try {
        if (f.size > MAX_EMOJI_IMAGE && f.type === 'image/gif') throw new Error(`"${f.name}" passa de 2 MB. Escolha um GIF menor.`);
        const blob = await emojiImage(f);
        if (blob.size > MAX_EMOJI_IMAGE) throw new Error(`"${f.name}" passa de 2 MB. Escolha uma imagem menor.`);
        const { key } = await this.api.upload(blob, f.type === 'image/gif' ? f.name : 'emoji.png');
        await this.api.post(this.path(), { name: this.nameFor(f, taken), file: key });
        done++;
      } catch (e) {
        this.ui.error(e);
      }
    }
    this.busy.set('');
    if (done) this.ui.toast(done === 1 ? 'Emoji adicionado.' : `${done} emojis adicionados.`, 'success');
  }

  rename(e: CustomEmoji, input: HTMLInputElement) {
    const name = input.value.trim().replace(/^:|:$/g, '');
    if (name === e.name) return;
    this.api.patch(`${this.path()}/${e.id}`, { name }).catch((err) => {
      input.value = e.name;
      this.ui.error(err);
    });
  }

  async remove(e: CustomEmoji) {
    const ok = await confirmDialog(this.ui, {
      title: 'Excluir emoji',
      body: `Excluir :${e.name}:? Ele some das mensagens e reações onde foi usado.`,
      confirmText: 'Excluir',
      danger: true,
    });
    if (ok) this.api.delete(`${this.path()}/${e.id}`).catch((err) => this.ui.error(err));
  }
}
