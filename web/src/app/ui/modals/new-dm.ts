import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Nav } from '../../core/nav';
import { Store } from '../../core/store';
import type { Channel } from '../../core/types';
import { Ui } from '../../core/ui';
import { Autofocus, Avatar, Icon } from '../shared';

@Component({
  selector: 'app-new-dm',
  imports: [FormsModule, Avatar, Icon, Autofocus],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <div class="modal" role="dialog">
      <button class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
      <div class="modal-body">
        <h2 class="left">Selecionar amigos</h2>
        <p class="modal-sub">Você pode adicionar mais {{ 9 - selected().size }} amigos.</p>
        <input class="input" placeholder="Digite o nome de usuário de um amigo" [ngModel]="filter()" (ngModelChange)="filter.set($event)" appAutofocus />
        <div class="invite-friends scroller thin">
          @for (u of friends(); track u.id) {
            <label class="invite-friend selectable">
              <app-avatar [user]="u" [size]="32" [status]="store.statusOf(u.id)" />
              <span class="invite-friend-name">{{ u.displayName }}</span>
              <span class="invite-friend-user">{{ u.username }}</span>
              <input type="checkbox" class="check" [checked]="selected().has(u.id)" (change)="toggle(u.id)" />
            </label>
          } @empty {
            <p class="hint">Você ainda não tem amigos para adicionar. Adicione alguém na aba Amigos!</p>
          }
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-brand btn-block" [disabled]="!selected().size || busy()" (click)="create()">
          {{ selected().size > 1 ? 'Criar grupo' : 'Criar MD' }}
        </button>
      </div>
    </div>
  `,
})
export class NewDm {
  readonly ui = inject(Ui);
  readonly store = inject(Store);
  private api = inject(Api);
  private nav = inject(Nav);
  readonly filter = signal('');
  readonly selected = signal<Set<number>>(new Set());
  readonly busy = signal(false);
  readonly friends = computed(() => {
    const q = this.filter().toLowerCase();
    return Object.entries(this.store.relationships())
      .filter(([, t]) => t === 'friend')
      .map(([id]) => this.store.users()[+id])
      .filter((u) => u && (!q || u.username.includes(q) || u.displayName.toLowerCase().includes(q)));
  });

  toggle(id: number) {
    const s = new Set(this.selected());
    if (s.has(id)) s.delete(id);
    else if (s.size < 9) s.add(id);
    this.selected.set(s);
  }

  async create() {
    this.busy.set(true);
    try {
      const ch = await this.api.post<Channel>('/dms', { recipients: [...this.selected()] });
      this.ui.close();
      this.nav.openChannel(null, ch.id);
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
