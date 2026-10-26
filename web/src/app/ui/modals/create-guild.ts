import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Nav } from '../../core/nav';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { Autofocus, Icon } from '../shared';
import { pickImage, squareImage } from './image';

@Component({
  selector: 'app-create-guild',
  imports: [FormsModule, Icon, Autofocus],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <div class="modal" role="dialog">
      <button class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
      @switch (step()) {
        @case ('start') {
          <div class="modal-body center">
            <h2>Crie seu servidor</h2>
            <p class="modal-text">Seu servidor é onde você e seus amigos se encontram. Crie o seu e comece a conversar.</p>
            <button class="choice" (click)="step.set('create')">
              <span class="choice-icon">🏠</span>
              <span>Criar o meu</span>
              <app-icon name="chevronRight" />
            </button>
            <div class="choice-sep">Para mim e meus amigos · Para um clube ou comunidade · Para o trabalho</div>
          </div>
          <div class="modal-footer column">
            <h3>Já tem um convite?</h3>
            <button class="btn btn-secondary btn-block" (click)="step.set('join')">Entrar em um servidor</button>
          </div>
        }
        @case ('create') {
          <form (ngSubmit)="create()">
            <div class="modal-body center">
              <h2>Personalize seu servidor</h2>
              <p class="modal-text">Deixe seu novo servidor com a sua cara dando a ele um nome e um ícone. Você pode mudar depois.</p>
              <button type="button" class="icon-upload" (click)="chooseIcon()">
                @if (preview()) {
                  <img [src]="preview()" alt="" />
                } @else {
                  <app-icon name="image" [size]="28" />
                  <span>ENVIAR</span>
                }
                <span class="icon-upload-plus"><app-icon name="plus" [size]="16" /></span>
              </button>
              <label class="field-label left" [class.error]="error()">
                Nome do servidor
                @if (error()) {
                  <span class="field-error"> - {{ error() }}</span>
                }
              </label>
              <input class="input" name="name" [(ngModel)]="name" appAutofocus maxlength="100" />
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link" (click)="step.set('start')">Voltar</button>
              <button type="submit" class="btn btn-brand" [disabled]="busy() || !name.trim()">Criar</button>
            </div>
          </form>
        }
        @case ('join') {
          <form (ngSubmit)="join()">
            <div class="modal-body center">
              <h2>Entrar em um servidor</h2>
              <p class="modal-text">Digite um convite abaixo para entrar em um servidor existente.</p>
              <label class="field-label left" [class.error]="error()">
                Link do convite <span class="req">*</span>
                @if (error()) {
                  <span class="field-error"> - {{ error() }}</span>
                }
              </label>
              <input class="input" name="code" [(ngModel)]="code" [placeholder]="origin + '/invite/aBcDeFgH'" appAutofocus />
              <div class="hint-block">
                <h3>Os convites são assim</h3>
                <p>aBcDeFgH</p>
                <p>{{ origin }}/invite/aBcDeFgH</p>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-link" (click)="step.set('start')">Voltar</button>
              <button type="submit" class="btn btn-brand" [disabled]="busy() || !code.trim()">Entrar no servidor</button>
            </div>
          </form>
        }
      }
    </div>
  `,
})
export class CreateGuild {
  readonly ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);
  private store = inject(Store);
  readonly step = signal<'start' | 'create' | 'join'>('start');
  readonly preview = signal<string | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly origin = location.origin;
  private icon: Blob | null = null;
  name = `Servidor de ${this.store.me()?.displayName ?? ''}`;
  code = '';

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
      const g = await this.api.post<{ id: number; systemChannelId: number }>('/guilds', { name: this.name, icon });
      this.ui.close();
      this.nav.go(`/channels/${g.id}/${g.systemChannelId}`);
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
