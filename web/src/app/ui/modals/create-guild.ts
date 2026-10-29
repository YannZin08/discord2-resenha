import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Nav } from '../../core/nav';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { initials } from '../../core/util';
import { Autofocus, Icon } from '../shared';
import { Tip } from '../tooltip';
import { pickImage, squareImage } from './image';

/** Create a server or join one with an invite: one small window, two tabs. */
@Component({
  selector: 'app-create-guild',
  imports: [FormsModule, Icon, Autofocus, Tip],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <div class="modal cg" role="dialog" aria-labelledby="cg-title">
      <button class="modal-x" aria-label="Fechar" (click)="ui.close()"><app-icon name="close" /></button>
      <h2 id="cg-title" class="cg-title">Novo servidor</h2>
      <div class="cg-tabs" role="tablist">
        <button type="button" role="tab" [class.active]="step() === 'create'" [attr.aria-selected]="step() === 'create'" (click)="switchTo('create')">
          Criar
        </button>
        <button type="button" role="tab" [class.active]="step() === 'join'" [attr.aria-selected]="step() === 'join'" (click)="switchTo('join')">
          Entrar com convite
        </button>
      </div>
      @if (step() === 'create') {
        <form class="cg-body" (ngSubmit)="create()">
          <div class="cg-row">
            <button type="button" class="cg-icon" [appTip]="preview() ? 'Trocar ícone' : 'Escolher ícone'" (click)="chooseIcon()">
              @if (preview()) {
                <img [src]="preview()" alt="" />
              } @else {
                <span>{{ acronym() }}</span>
              }
              <span class="cg-icon-badge"><app-icon name="image" [size]="14" /></span>
            </button>
            <label class="cg-field">
              <span class="cg-label">Nome</span>
              <input class="input" name="name" [(ngModel)]="name" appAutofocus maxlength="100" placeholder="Nome do servidor" />
            </label>
          </div>
          <div class="cg-channels">
            <span>Já vem com</span>
            <span class="cg-chip"># geral</span>
            <span class="cg-chip"># entradas-e-saídas</span>
            <span class="cg-chip"># música</span>
          </div>
          @if (error()) {
            <p class="cg-error">{{ error() }}</p>
          }
          <button type="submit" class="btn btn-brand btn-block cg-submit" [disabled]="busy() || !name.trim()">
            {{ busy() ? 'Criando...' : 'Criar servidor' }}
          </button>
        </form>
      } @else {
        <form class="cg-body" (ngSubmit)="join()">
          <label class="cg-field">
            <span class="cg-label">Link ou código do convite</span>
            <input class="input" name="code" [(ngModel)]="code" [placeholder]="origin + '/invite/aBcDeFgH'" appAutofocus />
          </label>
          @if (error()) {
            <p class="cg-error">{{ error() }}</p>
          }
          <button type="submit" class="btn btn-brand btn-block cg-submit" [disabled]="busy() || !code.trim()">
            {{ busy() ? 'Entrando...' : 'Entrar no servidor' }}
          </button>
        </form>
      }
    </div>
  `,
})
export class CreateGuild {
  readonly ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);
  private store = inject(Store);
  readonly step = signal<'create' | 'join'>('create');
  readonly preview = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly origin = location.origin;
  private icon: Blob | null = null;
  readonly nameText = signal(`Servidor de ${this.store.me()?.displayName ?? ''}`);
  /** Without an image the icon shows the name's initials, like it will in the server list. */
  readonly acronym = computed(() => initials(this.nameText()) || '?');
  code = '';

  get name() {
    return this.nameText();
  }
  set name(v: string) {
    this.nameText.set(v);
  }

  switchTo(step: 'create' | 'join') {
    this.step.set(step);
    this.error.set('');
  }

  async chooseIcon() {
    const f = await pickImage();
    if (!f) return;
    try {
      this.icon = await squareImage(f, 256);
      this.preview.set(URL.createObjectURL(this.icon));
    } catch (e) {
      this.ui.error(e);
    }
  }

  async create() {
    this.busy.set(true);
    this.error.set('');
    try {
      let icon: string | null = null;
      if (this.icon) icon = (await this.api.upload(this.icon, 'icon.png')).key;
      const g = await this.api.post<{ id: number; channelId: number }>('/guilds', { name: this.name, icon });
      this.ui.close();
      this.nav.go(`/channels/${g.id}/${g.channelId}`);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }

  async join() {
    const code = this.code.trim().split('/').filter(Boolean).pop() ?? '';
    this.busy.set(true);
    this.error.set('');
    try {
      const r = await this.api.post<{ guildId: number }>(`/invites/${encodeURIComponent(code)}`);
      this.ui.close();
      this.nav.go(`/channels/${r.guildId}`);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
