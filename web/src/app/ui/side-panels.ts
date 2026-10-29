import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Api } from '../core/api';
import { renderMarkdown } from '../core/markdown';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import type { Channel, Message } from '../core/types';
import { Ui } from '../core/ui';
import { formatTimestamp } from '../core/util';
import { Avatar, Icon } from './shared';
import { Tip } from './tooltip';

/** Compact, read-only message card used by the pins and search panels. */
@Component({
  selector: 'app-message-card',
  imports: [Avatar, Icon, Tip],
  template: `
    @let m = message();
    <div class="card-msg">
      <app-avatar [user]="m.author" [size]="32" />
      <div class="card-body">
        <div class="card-head">
          <span class="msg-author" [style.color]="store.colorIn(m.guildId, m.authorId)">{{ store.nameIn(m.guildId, m.authorId) }}</span>
          <span class="msg-time">{{ time() }}</span>
          @if (channelName()) {
            <span class="card-channel">#{{ channelName() }}</span>
          }
        </div>
        @if (m.content) {
          <div class="msg-content" [innerHTML]="html()"></div>
        }
        @if (m.attachments.length) {
          <div class="card-att"><app-icon name="file" [size]="16" /> {{ m.attachments.length }} anexo(s)</div>
        }
      </div>
      <div class="card-actions">
        <button class="card-jump" (click)="jump()">Ir</button>
        @if (onRemove()) {
          <button class="card-x" appTip="Desafixar" (click)="onRemove()!(m)"><app-icon name="close" [size]="14" /></button>
        }
      </div>
    </div>
  `,
})
export class MessageCard {
  readonly message = input.required<Message>();
  readonly showChannel = input(false);
  readonly onRemove = input<((m: Message) => void) | null>(null);
  readonly store = inject(Store);
  private nav = inject(Nav);
  private sanitizer = inject(DomSanitizer);

  readonly time = computed(() => formatTimestamp(this.message().createdAt));
  readonly channelName = computed(() => (this.showChannel() ? this.store.channels()[this.message().channelId]?.name : null));
  readonly html = computed<SafeHtml>(() => {
    const m = this.message();
    return this.sanitizer.bypassSecurityTrustHtml(
      renderMarkdown(m.content, {
        userName: (id) => (this.store.users()[id] ? this.store.nameIn(m.guildId, id) : null),
        channelName: (id) => this.store.channels()[id]?.name ?? null,
        meId: this.store.me()?.id,
      }),
    );
  });

  jump() {
    const m = this.message();
    this.nav.jump(m.guildId, m.channelId, m.id);
  }
}

@Component({
  selector: 'app-pins-panel',
  imports: [MessageCard, Icon],
  template: `
    <aside class="side-panel">
      <header class="side-panel-head">
        <app-icon name="pin" [size]="20" />
        <h2>Mensagens fixadas</h2>
        <button class="icon-btn" (click)="ui.panel.set(null)"><app-icon name="close" [size]="20" /></button>
      </header>
      <div class="side-panel-body scroller thin">
        @if (loading()) {
          <div class="spinner"></div>
        } @else {
          @for (m of pins(); track m.id) {
            <app-message-card [message]="m" [onRemove]="canManage() ? unpin : null" />
          } @empty {
            <div class="side-empty">
              <div class="side-empty-art">📌</div>
              <p>Este canal ainda não tem nenhuma mensagem fixada.</p>
            </div>
          }
        }
      </div>
    </aside>
  `,
})
export class PinsPanel {
  readonly channel = input.required<Channel>();
  readonly ui = inject(Ui);
  private api = inject(Api);
  private store = inject(Store);
  readonly pins = signal<Message[]>([]);
  readonly loading = signal(true);
  readonly canManage = computed(() => this.channel().guildId == null || this.store.isAdmin(this.channel().guildId));

  constructor() {
    effect(() => {
      const c = this.channel();
      this.store.pinsVersion()[c.id];
      untracked(() => {
        this.api
          .get<Message[]>(`/channels/${c.id}/pins`)
          .then((p) => this.pins.set(p))
          .catch((e) => this.ui.error(e))
          .finally(() => this.loading.set(false));
      });
    });
  }

  readonly unpin = (m: Message) => {
    this.api.delete(`/channels/${m.channelId}/pins/${m.id}`).catch((e) => this.ui.error(e));
  };
}

@Component({
  selector: 'app-search-panel',
  imports: [MessageCard, Icon],
  template: `
    <aside class="side-panel">
      <header class="side-panel-head">
        <app-icon name="search" [size]="20" />
        <h2>{{ loading() ? 'Buscando...' : results().length ? results().length + (results().length === 1 ? ' resultado' : ' resultados') : 'Nenhum resultado' }}</h2>
        <button class="icon-btn" (click)="ui.panel.set(null)"><app-icon name="close" [size]="20" /></button>
      </header>
      <div class="side-panel-body scroller thin">
        @if (loading()) {
          <div class="spinner"></div>
        } @else {
          @for (m of results(); track m.id) {
            <app-message-card [message]="m" [showChannel]="channel().guildId != null" />
          } @empty {
            <div class="side-empty">
              <div class="side-empty-art">🔍</div>
              <p>Nenhum resultado para "{{ ui.searchQuery() }}".</p>
            </div>
          }
        }
      </div>
    </aside>
  `,
})
export class SearchPanel {
  readonly channel = input.required<Channel>();
  readonly ui = inject(Ui);
  private api = inject(Api);
  readonly results = signal<Message[]>([]);
  readonly loading = signal(true);

  constructor() {
    effect(() => {
      const q = this.ui.searchQuery();
      const c = this.channel();
      untracked(() => {
        this.loading.set(true);
        const where = c.guildId != null ? `guildId=${c.guildId}` : `channelId=${c.id}`;
        this.api
          .get<Message[]>(`/search?${where}&q=${encodeURIComponent(q)}`)
          .then((r) => this.results.set(r))
          .catch((e) => this.ui.error(e))
          .finally(() => this.loading.set(false));
      });
    });
  }
}
