import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Nav } from '../../core/nav';
import { Store } from '../../core/store';
import type { Channel } from '../../core/types';
import { Ui } from '../../core/ui';
import { channelLabel } from '../../core/util';
import { Autofocus, Avatar, GuildIcon, Icon } from '../shared';

interface Item {
  key: string;
  label: string;
  sub: string;
  kind: 'channel' | 'dm' | 'guild' | 'user';
  icon?: string;
  run: () => void;
}

/** Ctrl+K: jump to any channel, conversation, server or friend. */
@Component({
  selector: 'app-quick-switcher',
  imports: [FormsModule, Icon, Avatar, GuildIcon, Autofocus],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <div class="modal switcher" role="dialog">
      <div class="modal-body">
        <input
          class="input big"
          placeholder="Para onde você gostaria de ir?"
          [ngModel]="query()"
          (ngModelChange)="query.set($event); index.set(0)"
          (keydown)="key($event)"
          appAutofocus
        />
        <div class="switcher-list scroller thin">
          @for (it of items(); track it.key) {
            <div class="switcher-item" [class.active]="$index === index()" (mouseenter)="index.set($index)" (click)="it.run()">
              @switch (it.kind) {
                @case ('channel') {
                  <app-icon [name]="it.icon!" [size]="20" />
                }
                @case ('guild') {
                  <span class="switcher-gicon"><app-guild-icon [name]="it.label" [icon]="it.icon ?? null" [size]="20" /></span>
                }
                @default {
                  <app-avatar [user]="userOf(it)" [size]="20" />
                }
              }
              <span class="switcher-label">{{ it.label }}</span>
              <span class="switcher-sub">{{ it.sub }}</span>
            </div>
          } @empty {
            <p class="hint">Nada encontrado.</p>
          }
        </div>
        <p class="hint">DICA: use ↑ ↓ para navegar e Enter para abrir.</p>
      </div>
    </div>
  `,
})
export class QuickSwitcher {
  readonly ui = inject(Ui);
  private store = inject(Store);
  private nav = inject(Nav);
  private api = inject(Api);
  readonly query = signal('');
  readonly index = signal(0);

  readonly items = computed<Item[]>(() => {
    const q = this.query().trim().toLowerCase().replace(/^[#@*]/, '');
    const me = this.store.me()?.id;
    const out: Item[] = [];
    const open = (c: Channel) => () => {
      this.ui.close();
      this.nav.openChannel(c.guildId, c.id);
    };
    for (const c of this.store.privateChannels()) {
      out.push({ key: 'c' + c.id, label: channelLabel(c, this.store.users(), me), sub: 'Mensagem direta', kind: 'dm', run: open(c) });
    }
    for (const g of this.store.guildList()) {
      for (const c of this.store.guildChannels(g.id)) {
        if (c.type === 'category') continue;
        out.push({ key: 'c' + c.id, label: c.name, sub: g.name, kind: 'channel', icon: c.type === 'voice' ? 'speaker' : 'hash', run: open(c) });
      }
      out.push({
        key: 'g' + g.id,
        label: g.name,
        sub: 'Servidor',
        kind: 'guild',
        icon: g.icon ?? undefined,
        run: () => {
          this.ui.close();
          this.nav.go(`/channels/${g.id}`);
        },
      });
    }
    for (const [id, t] of Object.entries(this.store.relationships())) {
      const u = this.store.users()[+id];
      if (t !== 'friend' || !u) continue;
      if (this.store.privateChannels().some((c) => c.type === 'dm' && c.recipients?.includes(u.id))) continue;
      out.push({
        key: 'u' + u.id,
        label: u.displayName,
        sub: u.username,
        kind: 'user',
        run: async () => {
          this.ui.close();
          const ch = await this.api.post<Channel>('/dms', { recipients: [u.id] });
          this.nav.openChannel(null, ch.id);
        },
      });
    }
    const filtered = q ? out.filter((i) => i.label.toLowerCase().includes(q) || i.sub.toLowerCase().includes(q)) : out.filter((i) => i.kind !== 'user');
    return filtered.slice(0, 20);
  });

  userOf(it: Item) {
    if (it.kind === 'user') return this.store.users()[+it.key.slice(1)];
    const c = this.store.channels()[+it.key.slice(1)];
    return this.store.dmPartner(c);
  }

  key(e: KeyboardEvent) {
    const n = this.items().length;
    if (!n) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.index.set((this.index() + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.index.set((this.index() - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.items()[this.index()]?.run();
    }
  }
}
