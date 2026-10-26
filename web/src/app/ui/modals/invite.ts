import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Store } from '../../core/store';
import type { Channel } from '../../core/types';
import { Ui } from '../../core/ui';
import { copyText, uid } from '../../core/util';
import { Avatar, Icon } from '../shared';

@Component({
  selector: 'app-invite-modal',
  imports: [FormsModule, Icon, Avatar],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <div class="modal" role="dialog">
      <button class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
      <div class="modal-body">
        <h2 class="left">Convide amigos para {{ guild().name }}</h2>
        @if (friends().length) {
          <input class="input" placeholder="Buscar amigos" [ngModel]="filter()" (ngModelChange)="filter.set($event)" />
          <div class="invite-friends scroller thin">
            @for (u of friends(); track u.id) {
              <div class="invite-friend">
                <app-avatar [user]="u" [size]="32" [status]="store.statusOf(u.id)" />
                <span class="invite-friend-name">{{ u.displayName }}</span>
                <span class="invite-friend-user">{{ u.username }}</span>
                <button class="btn btn-outline-success small" [disabled]="sent().has(u.id)" (click)="send(u.id)">
                  {{ sent().has(u.id) ? 'Enviado' : 'Convidar' }}
                </button>
              </div>
            }
          </div>
        }
        <label class="field-label">Ou envie um link de convite para um amigo</label>
        <div class="copy-box" [class.copied]="copied()">
          <input readonly [value]="link()" (focus)="$any($event.target).select()" />
          <button class="btn" [class.btn-brand]="!copied()" [class.btn-success]="copied()" (click)="copy()" [disabled]="!code()">
            {{ copied() ? 'Copiado' : 'Copiar' }}
          </button>
        </div>
        <p class="hint">O link não expira.</p>
      </div>
    </div>
  `,
})
export class InviteModal {
  readonly guildId = input.required<number>();
  readonly ui = inject(Ui);
  readonly store = inject(Store);
  private api = inject(Api);
  readonly code = signal('');
  readonly copied = signal(false);
  readonly filter = signal('');
  readonly sent = signal<Set<number>>(new Set());
  readonly guild = computed(() => this.store.guilds()[this.guildId()]);
  readonly link = computed(() => (this.code() ? `${location.origin}/invite/${this.code()}` : 'Gerando convite...'));
  readonly friends = computed(() => {
    const members = this.store.members()[this.guildId()] ?? {};
    const q = this.filter().toLowerCase();
    return Object.entries(this.store.relationships())
      .filter(([id, t]) => t === 'friend' && !members[+id])
      .map(([id]) => this.store.users()[+id])
      .filter((u) => u && (!q || u.username.includes(q) || u.displayName.toLowerCase().includes(q)));
  });

  ngOnInit() {
    this.api
      .post<{ code: string }>(`/guilds/${this.guildId()}/invites`)
      .then((r) => this.code.set(r.code))
      .catch((e) => this.ui.error(e));
  }

  async copy() {
    await copyText(this.link());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  async send(userId: number) {
    try {
      const ch = await this.api.post<Channel>('/dms', { recipients: [userId] });
      await this.api.post(`/channels/${ch.id}/messages`, { content: this.link(), nonce: uid() });
      this.sent.update((s) => new Set(s).add(userId));
    } catch (e) {
      this.ui.error(e);
    }
  }
}
