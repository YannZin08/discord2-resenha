import { Component, computed, inject } from '@angular/core';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import type { Channel } from '../core/types';
import { Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { channelLabel, copyText } from '../core/util';
import { userMenuItems } from './menus';
import { NewDm } from './modals/new-dm';
import { QuickSwitcher } from './modals/quick-switcher';
import { Avatar, Icon } from './shared';
import { Tip } from './tooltip';

@Component({
  selector: 'app-dm-sidebar',
  imports: [Avatar, Icon, Tip],
  template: `
    <header class="sidebar-header">
      <button class="dm-search" (click)="ui.open(switcher)">Encontre ou comece uma conversa</button>
    </header>
    <div class="channel-list scroller thin">
      <div class="dm-nav-item" [class.active]="nav.channelId() == null" (click)="nav.home()">
        <app-icon name="friends" />
        <span>Amigos</span>
        @if (pending(); as n) {
          <span class="badge">{{ n }}</span>
        }
      </div>
      <div class="dm-header">
        <span>Mensagens diretas</span>
        <button appTip="Criar MD" (click)="ui.open(newDm)"><app-icon name="plus" [size]="16" /></button>
      </div>
      @for (c of store.privateChannels(); track c.id) {
        <div
          class="dm-item"
          [class.active]="nav.channelId() === c.id"
          [class.unread]="store.isUnread(c)"
          (click)="nav.openChannel(null, c.id)"
          (contextmenu)="menu($event, c)"
        >
          @if (c.type === 'dm') {
            <app-avatar [user]="store.dmPartner(c)" [size]="32" [status]="store.statusOf(store.dmPartner(c)?.id ?? 0)" />
          } @else {
            <span class="group-icon small"><app-icon name="group" [size]="18" /></span>
          }
          <div class="dm-text">
            <div class="dm-name">{{ label(c) }}</div>
            @if (c.type === 'group_dm') {
              <div class="dm-sub">{{ c.recipients?.length }} membros</div>
            } @else if (store.dmPartner(c)?.customStatus; as cs) {
              <div class="dm-sub">{{ cs }}</div>
            }
          </div>
          @if (store.mentionCount(c.id); as n) {
            <span class="badge">{{ n }}</span>
          }
          <button class="dm-close" (click)="close($event, c)" appTip="Fechar MD"><app-icon name="close" [size]="16" /></button>
        </div>
      } @empty {
        <div class="dm-empty">Suas conversas aparecem aqui.</div>
      }
    </div>
  `,
})
export class DmSidebar {
  readonly store = inject(Store);
  readonly nav = inject(Nav);
  readonly ui = inject(Ui);
  private api = inject(Api);
  private voice = inject(Voice);
  readonly switcher = QuickSwitcher;
  readonly newDm = NewDm;
  readonly pending = computed(() => Object.values(this.store.relationships()).filter((t) => t === 'incoming').length);

  label(c: Channel) {
    return channelLabel(c, this.store.users(), this.store.me()?.id);
  }

  close(e: MouseEvent, c: Channel) {
    e.stopPropagation();
    if (this.nav.channelId() === c.id) this.nav.home();
    this.api.delete(`/channels/${c.id}`).catch((err) => this.ui.error(err));
  }

  menu(e: MouseEvent, c: Channel) {
    const partner = this.store.dmPartner(c);
    const el = e.currentTarget as Element;
    const base = partner
      ? userMenuItems(partner.id, null, { store: this.store, ui: this.ui, api: this.api, nav: this.nav, voice: this.voice }, el)
      : [{ label: 'Copiar ID do canal', action: () => void copyText(String(c.id)) }];
    this.ui.openMenu(e, [
      { label: 'Marcar como lida', disabled: !this.store.isUnread(c), action: () => void this.api.post(`/channels/${c.id}/ack`, {}) },
      { separator: true },
      ...base,
      { separator: true },
      { label: c.type === 'group_dm' ? 'Sair do grupo' : 'Fechar MD', danger: c.type === 'group_dm', action: () => this.close(e, c) },
    ]);
  }
}
