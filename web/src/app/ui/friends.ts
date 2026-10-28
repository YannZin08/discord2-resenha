import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import type { Channel, RelType, User } from '../core/types';
import { Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { userMenuItems } from './menus';
import { Avatar, Icon, STATUS_LABELS } from './shared';
import { Tip } from './tooltip';

type Tab = 'online' | 'all' | 'pending' | 'blocked' | 'add';

@Component({
  selector: 'app-friends',
  imports: [Avatar, Icon, Tip, FormsModule],
  template: `
    <section class="friends">
      <header class="chat-header">
        <button class="icon-btn mobile-only" (click)="ui.mobileNav.set(true)"><app-icon name="menu" /></button>
        <app-icon class="chat-hash" name="friends" />
        <h1 class="chat-title">Amigos</h1>
        <div class="chat-topic-sep"></div>
        <nav class="friends-tabs">
          <button [class.active]="tab() === 'online'" (click)="tab.set('online')">Disponível</button>
          <button [class.active]="tab() === 'all'" (click)="tab.set('all')">Todos</button>
          <button [class.active]="tab() === 'pending'" (click)="tab.set('pending')">
            Pendente
            @if (incoming(); as n) {
              <span class="badge">{{ n }}</span>
            }
          </button>
          <button [class.active]="tab() === 'blocked'" (click)="tab.set('blocked')">Bloqueado</button>
          <button class="add-friend-tab" [class.active]="tab() === 'add'" (click)="tab.set('add')">Adicionar amigo</button>
        </nav>
      </header>
      <div class="friends-body">
        <div class="friends-main scroller">
          @if (tab() === 'add') {
            <div class="add-friend">
              <h2>ADICIONAR AMIGO</h2>
              <p>Você pode adicionar amigos com o nome de usuário deles.</p>
              <form class="add-friend-box" [class.error]="addError()" [class.success]="addOk()" (ngSubmit)="add()">
                <input name="u" [(ngModel)]="username" placeholder="Você pode adicionar amigos com o nome de usuário deles." autocomplete="off" />
                <button class="btn btn-brand" type="submit" [disabled]="!username.trim()">Enviar pedido de amizade</button>
              </form>
              @if (addError()) {
                <p class="add-msg error">{{ addError() }}</p>
              } @else if (addOk()) {
                <p class="add-msg success">{{ addOk() }}</p>
              }
            </div>
          } @else {
            <div class="friends-search">
              <input placeholder="Buscar" [ngModel]="filter()" (ngModelChange)="filter.set($event)" />
              <app-icon name="search" [size]="18" />
            </div>
            <h3 class="friends-count">{{ heading() }} — {{ rows().length }}</h3>
            @for (r of rows(); track r.user.id) {
              <div class="friend-row" (click)="message(r.user)" (contextmenu)="menu($event, r.user)">
                <app-avatar [user]="r.user" [size]="32" [status]="r.type === 'friend' ? store.statusOf(r.user.id) : null" />
                <div class="friend-text">
                  <div class="friend-name">
                    {{ r.user.displayName }} <span class="friend-username">{{ r.user.username }}</span>
                  </div>
                  <div class="friend-sub">
                    @switch (r.type) {
                      @case ('incoming') {
                        Pedido de amizade recebido
                      }
                      @case ('outgoing') {
                        Pedido de amizade enviado
                      }
                      @case ('blocked') {
                        Bloqueado
                      }
                      @default {
                        @if (store.activityOf(r.user.id); as a) {
                          <span class="activity-line">Jogando <strong>{{ a.name }}</strong></span>
                        } @else {
                          {{ r.user.customStatus || statusLabel(r.user.id) }}
                        }
                      }
                    }
                  </div>
                </div>
                <div class="friend-actions" (click)="$event.stopPropagation()">
                  @switch (r.type) {
                    @case ('friend') {
                      <button appTip="Mensagem" (click)="message(r.user)"><app-icon name="chat" [size]="20" /></button>
                      <button appTip="Mais" (click)="menu($event, r.user)"><app-icon name="moreVert" [size]="20" /></button>
                    }
                    @case ('incoming') {
                      <button class="accept" appTip="Aceitar" (click)="accept(r.user)"><app-icon name="check" [size]="20" /></button>
                      <button class="deny" appTip="Ignorar" (click)="remove(r.user)"><app-icon name="close" [size]="20" /></button>
                    }
                    @default {
                      <button class="deny" [appTip]="r.type === 'blocked' ? 'Desbloquear' : 'Cancelar'" (click)="remove(r.user)">
                        <app-icon name="close" [size]="20" />
                      </button>
                    }
                  }
                </div>
              </div>
            } @empty {
              <div class="friends-empty">
                <div class="friends-empty-art">🙋</div>
                <p>{{ emptyText() }}</p>
              </div>
            }
          }
        </div>
        <aside class="active-now">
          <h2>Ativo agora</h2>
          @for (v of activeNow(); track v.userId) {
            <div class="active-card" (click)="goVoice(v.channelId)">
              <app-avatar [user]="store.users()[v.userId]" [size]="32" [status]="store.statusOf(v.userId)" />
              <div>
                <div class="active-name">{{ store.users()[v.userId]?.displayName }}</div>
                <div class="active-sub">{{ v.where }}</div>
              </div>
            </div>
          } @empty {
            <div class="active-empty">
              <strong>Está tranquilo por enquanto...</strong>
              <p>Quando um amigo entrar em um canal de voz, ele vai aparecer aqui.</p>
            </div>
          }
        </aside>
      </div>
    </section>
  `,
  host: { class: 'chat-host' },
})
export class Friends {
  readonly store = inject(Store);
  readonly ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);
  private voice = inject(Voice);
  readonly tab = signal<Tab>('online');
  readonly addError = signal('');
  readonly addOk = signal('');
  readonly filter = signal('');
  username = '';

  readonly incoming = computed(() => Object.values(this.store.relationships()).filter((t) => t === 'incoming').length);

  readonly rows = computed(() => {
    const tab = this.tab();
    const users = this.store.users();
    const q = this.filter().toLowerCase();
    return Object.entries(this.store.relationships())
      .map(([id, type]) => ({ user: users[+id], type: type as RelType }))
      .filter((r) => !!r.user)
      .filter((r) => {
        if (tab === 'online') return r.type === 'friend' && this.store.statusOf(r.user.id) !== 'offline';
        if (tab === 'all') return r.type === 'friend';
        if (tab === 'pending') return r.type === 'incoming' || r.type === 'outgoing';
        if (tab === 'blocked') return r.type === 'blocked';
        return false;
      })
      .filter((r) => !q || r.user.username.includes(q) || r.user.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.user.displayName.localeCompare(b.user.displayName, 'pt-BR'));
  });

  readonly heading = computed(
    () => ({ online: 'DISPONÍVEL', all: 'TODOS OS AMIGOS', pending: 'PENDENTE', blocked: 'BLOQUEADO', add: '' })[this.tab()],
  );

  readonly emptyText = computed(
    () =>
      ({
        online: 'Não tem ninguém por perto para brincar.',
        all: 'Você ainda não tem amigos. Que tal adicionar alguém?',
        pending: 'Não há pedidos de amizade pendentes.',
        blocked: 'Você não bloqueou ninguém.',
        add: '',
      })[this.tab()],
  );

  readonly activeNow = computed(() => {
    const friends = new Set(
      Object.entries(this.store.relationships())
        .filter(([, t]) => t === 'friend')
        .map(([id]) => +id),
    );
    const seen = new Set<number>();
    const out: { userId: number; channelId: number; where: string }[] = [];
    for (const v of Object.values(this.store.voiceStates())) {
      if (!friends.has(v.userId) || seen.has(v.userId) || v.channelId == null) continue;
      seen.add(v.userId);
      const c = this.store.channels()[v.channelId];
      const where = c?.guildId != null ? `${c.name} — ${this.store.guilds()[c.guildId]?.name}` : 'Em uma chamada';
      out.push({ userId: v.userId, channelId: v.channelId, where });
    }
    return out;
  });

  statusLabel(id: number) {
    return STATUS_LABELS[this.store.statusOf(id)];
  }

  async add() {
    this.addError.set('');
    this.addOk.set('');
    const name = this.username.trim();
    try {
      await this.api.post('/relationships', { username: name });
      this.addOk.set(`Pronto! Seu pedido de amizade para ${name} foi enviado.`);
      this.username = '';
    } catch (e) {
      this.addError.set(e instanceof Error ? e.message : String(e));
    }
  }

  accept(u: User) {
    this.api.put(`/relationships/${u.id}`, { type: 'friend' }).catch((e) => this.ui.error(e));
  }

  remove(u: User) {
    this.api.delete(`/relationships/${u.id}`).catch((e) => this.ui.error(e));
  }

  async message(u: User) {
    try {
      const ch = await this.api.post<Channel>('/dms', { recipients: [u.id] });
      this.nav.openChannel(null, ch.id);
    } catch (e) {
      this.ui.error(e);
    }
  }

  goVoice(channelId: number) {
    const c = this.store.channels()[channelId];
    if (c) this.nav.openChannel(c.guildId, c.id);
  }

  menu(e: MouseEvent, u: User) {
    const el = e.currentTarget as Element;
    this.ui.openMenu(e, userMenuItems(u.id, null, { store: this.store, ui: this.ui, api: this.api, nav: this.nav, voice: this.voice }, el));
  }
}
