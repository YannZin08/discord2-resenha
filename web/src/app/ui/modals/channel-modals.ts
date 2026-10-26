import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Nav } from '../../core/nav';
import { Store } from '../../core/store';
import type { Channel } from '../../core/types';
import { Ui } from '../../core/ui';
import { Autofocus, Icon } from '../shared';
import { confirmDialog } from './dialogs';

@Component({
  selector: 'app-create-channel',
  imports: [FormsModule, Icon, Autofocus],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <form class="modal" role="dialog" (ngSubmit)="create()">
      <button type="button" class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
      <div class="modal-body">
        <h2 class="left">{{ category() ? 'Criar categoria' : 'Criar canal' }}</h2>
        @if (parentName()) {
          <p class="modal-sub">em {{ parentName() }}</p>
        }
        @if (!category()) {
          <label class="field-label">Tipo de canal</label>
          <label class="radio-card" [class.active]="type === 'text'">
            <input type="radio" name="type" value="text" [(ngModel)]="type" />
            <app-icon name="hash" />
            <div>
              <div class="rc-title">Texto</div>
              <div class="rc-sub">Envie mensagens, imagens, GIFs, emojis, opiniões e piadas</div>
            </div>
          </label>
          <label class="radio-card" [class.active]="type === 'voice'">
            <input type="radio" name="type" value="voice" [(ngModel)]="type" />
            <app-icon name="speaker" />
            <div>
              <div class="rc-title">Voz</div>
              <div class="rc-sub">Converse por voz, vídeo e compartilhamento de tela</div>
            </div>
          </label>
        }
        <label class="field-label" [class.error]="error()">
          {{ category() ? 'Nome da categoria' : 'Nome do canal' }}
          @if (error()) {
            <span class="field-error"> - {{ error() }}</span>
          }
        </label>
        <div class="input-icon">
          @if (!category()) {
            <app-icon [name]="type === 'voice' ? 'speaker' : 'hash'" [size]="18" />
          }
          <input class="input" name="name" [(ngModel)]="name" [placeholder]="category() ? 'Nova categoria' : 'novo-canal'" appAutofocus maxlength="100" />
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-link" (click)="ui.close()">Cancelar</button>
        <button type="submit" class="btn btn-brand" [disabled]="busy() || !name.trim()">{{ category() ? 'Criar categoria' : 'Criar canal' }}</button>
      </div>
    </form>
  `,
})
export class CreateChannel {
  readonly guildId = input.required<number>();
  readonly parentId = input<number | null>(null);
  readonly category = input(false);
  readonly ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);
  private store = inject(Store);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly parentName = computed(() => (this.parentId() ? this.store.channels()[this.parentId()!]?.name : null));
  type: 'text' | 'voice' = 'text';
  name = '';

  async create() {
    this.busy.set(true);
    this.error.set('');
    try {
      const c = await this.api.post<Channel>(`/guilds/${this.guildId()}/channels`, {
        name: this.name,
        type: this.category() ? 'category' : this.type,
        parentId: this.parentId(),
      });
      this.ui.close();
      if (c.type === 'text') this.nav.openChannel(c.guildId, c.id);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}

@Component({
  selector: 'app-channel-settings',
  imports: [FormsModule, Icon],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    @if (channel(); as c) {
      <form class="modal" role="dialog" (ngSubmit)="save()">
        <button type="button" class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
        <div class="modal-body">
          <h2 class="left">{{ c.type === 'category' ? 'Editar categoria' : 'Editar canal' }}</h2>
          <label class="field-label" [class.error]="error()">
            Nome
            @if (error()) {
              <span class="field-error"> - {{ error() }}</span>
            }
          </label>
          <input class="input" name="name" [(ngModel)]="name" maxlength="100" />
          @if (c.type === 'text') {
            <label class="field-label">Tópico do canal</label>
            <textarea class="input textarea" name="topic" [(ngModel)]="topic" maxlength="1024" rows="3" placeholder="Diga a todo mundo como usar este canal!"></textarea>
          }
          @if (categories().length && c.type !== 'category') {
            <label class="field-label">Categoria</label>
            <select class="input" name="parent" [(ngModel)]="parentId">
              <option [ngValue]="null">Sem categoria</option>
              @for (cat of categories(); track cat.id) {
                <option [ngValue]="cat.id">{{ cat.name }}</option>
              }
            </select>
          }
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-danger-outline" (click)="remove()">Excluir</button>
          <span class="spacer"></span>
          <button type="button" class="btn btn-link" (click)="ui.close()">Cancelar</button>
          <button type="submit" class="btn btn-brand" [disabled]="busy()">Salvar alterações</button>
        </div>
      </form>
    }
  `,
})
export class ChannelSettings {
  readonly channelId = input.required<number>();
  readonly ui = inject(Ui);
  private api = inject(Api);
  private store = inject(Store);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly channel = computed(() => this.store.channels()[this.channelId()]);
  readonly categories = computed(() => {
    const c = this.channel();
    return c?.guildId != null ? this.store.guildChannels(c.guildId).filter((x) => x.type === 'category') : [];
  });
  name = '';
  topic = '';
  parentId: number | null = null;

  ngOnInit() {
    const c = this.channel();
    if (!c) return;
    this.name = c.name;
    this.topic = c.topic;
    this.parentId = c.parentId;
  }

  async save() {
    const c = this.channel()!;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.patch(`/channels/${c.id}`, { name: this.name, topic: this.topic });
      if (c.type !== 'category' && this.parentId !== c.parentId && c.guildId != null) {
        const siblings = this.store.guildChannels(c.guildId).filter((x) => x.parentId === this.parentId);
        const position = siblings.reduce((p, x) => Math.max(p, x.position), -1) + 1;
        await this.api.patch(`/guilds/${c.guildId}/channels`, { channels: [{ id: c.id, position, parentId: this.parentId }] });
      }
      this.ui.close();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  async remove() {
    const c = this.channel()!;
    const ok = await confirmDialog(this.ui, {
      title: c.type === 'category' ? 'Excluir categoria' : 'Excluir canal',
      body: `Tem certeza de que deseja excluir ${c.type === 'text' ? '#' : ''}${c.name}? Isso não pode ser desfeito.`,
      confirmText: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`/channels/${c.id}`);
      this.ui.close();
    } catch (e) {
      this.ui.error(e);
    }
  }
}
