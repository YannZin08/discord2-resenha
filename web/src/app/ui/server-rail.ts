import { Component, computed, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import type { Channel, Guild, User } from '../core/types';
import { MenuItem, Ui } from '../core/ui';
import { channelLabel, copyText } from '../core/util';
import { Voice } from '../core/voice';
import { guildMenuItems } from './menus';
import { CreateGuild } from './modals/create-guild';
import { Avatar, GuildIcon, Icon, Logo } from './shared';
import { Tip } from './tooltip';

@Component({
  selector: 'app-server-rail',
  imports: [Logo, GuildIcon, Icon, Avatar, Tip],
  template: `
    <nav class="rail">
      <div class="rail-item" [class.active]="isHome()">
        <span class="rail-pill"></span>
        <button class="rail-btn home" appTip="Mensagens diretas" tipSide="right" (click)="nav.go(homePath())">
          <app-logo [size]="28" />
        </button>
        @if (friendRequests(); as n) {
          <span class="badge rail-badge">{{ n }}</span>
        }
      </div>

      @for (c of unreadDms(); track c.id) {
        <div class="rail-item">
          <button class="rail-btn dm" [appTip]="label(c)" tipSide="right" (click)="nav.openChannel(null, c.id)">
            @if (c.type === 'dm') {
              <app-avatar [user]="store.dmPartner(c)" [size]="48" />
            } @else {
              <span class="group-icon"><app-icon name="group" /></span>
            }
          </button>
          <span class="badge rail-badge">{{ store.mentionCount(c.id) }}</span>
        </div>
      }

      <div class="rail-sep"></div>

      @for (g of store.guildList(); track g.id) {
        <div
          class="rail-item"
          [class.active]="nav.guildId() === g.id"
          [class.unread]="store.guildUnread(g.id)"
          [class.drop-target]="dropTarget() === g.id"
          draggable="true"
          (dragstart)="dragging.set(g.id)"
          (dragend)="dragging.set(null); dropTarget.set(null)"
          (dragover)="dragOver($event, g.id)"
          (drop)="drop(g.id)"
        >
          <span class="rail-pill"></span>
          <button
            class="rail-btn"
            [appTip]="g.name"
            [tipVoice]="inVoice()[g.id]"
            tipSide="right"
            (click)="open(g)"
            (contextmenu)="menu($event, g)"
          >
            <app-guild-icon [name]="g.name" [icon]="g.icon" />
          </button>
          @if (store.guildMentions(g.id); as n) {
            <span class="badge rail-badge">{{ n }}</span>
          }
          <!-- Only the call you're in, like Discord; who's in other calls shows when you hover the server. -->
          @if (myCallGuild() === g.id) {
            <span class="rail-voice" [class.top]="!!store.guildMentions(g.id)"><app-icon name="speaker" [size]="12" /></span>
          }
        </div>
      }

      <div class="rail-item">
        <button class="rail-btn add" appTip="Adicionar um servidor" tipSide="right" (click)="ui.open(createGuild)">
          <app-icon name="plus" />
        </button>
      </div>
    </nav>
  `,
})
export class ServerRail {
  readonly store = inject(Store);
  readonly nav = inject(Nav);
  readonly ui = inject(Ui);
  private api = inject(Api);
  private voice = inject(Voice);
  readonly createGuild = CreateGuild;
  readonly dragging = signal<number | null>(null);
  readonly dropTarget = signal<number | null>(null);

  readonly isHome = computed(() => this.nav.route().name === 'app' && this.nav.guildId() == null);
  readonly homePath = computed(() => {
    const last = this.nav.lastChannel('@me');
    return last && this.store.channels()[last] ? `/channels/@me/${last}` : '/channels/@me';
  });
  readonly unreadDms = computed(() => this.store.privateChannels().filter((c) => this.store.mentionCount(c.id) > 0 && this.nav.channelId() !== c.id));
  readonly friendRequests = computed(() => Object.values(this.store.relationships()).filter((t) => t === 'incoming').length);
  /** The server whose call you're in (its icon gets the green speaker). */
  readonly myCallGuild = computed(() => (this.voice.channelId() ? this.voice.guildId() : null));
  /** Who is in a call in each server: the faces in its tooltip. */
  readonly inVoice = computed(() => {
    const users = this.store.users();
    const out: Record<number, User[]> = {};
    for (const v of Object.values(this.store.voiceStates())) {
      const u = users[v.userId];
      if (v.guildId == null || v.channelId == null || !u) continue;
      (out[v.guildId] ??= []).push(u);
    }
    return out;
  });

  label(c: Channel) {
    return channelLabel(c, this.store.users(), this.store.me()?.id);
  }

  open(g: Guild) {
    const last = this.nav.lastChannel(g.id);
    this.nav.go(last && this.store.channels()[last]?.guildId === g.id ? `/channels/${g.id}/${last}` : `/channels/${g.id}`);
  }

  menu(e: MouseEvent, g: Guild) {
    const items: MenuItem[] = guildMenuItems(g, this.store, this.ui, this.api, this.nav);
    items.push({ separator: true }, { label: 'Copiar ID do servidor', icon: 'copy', action: () => void copyText(String(g.id)) });
    this.ui.openMenu(e, items);
  }

  dragOver(e: DragEvent, id: number) {
    if (this.dragging() == null) return;
    e.preventDefault();
    this.dropTarget.set(id);
  }

  drop(target: number) {
    const from = this.dragging();
    this.dragging.set(null);
    this.dropTarget.set(null);
    if (from == null || from === target) return;
    const order = this.store.guildList().map((g) => g.id).filter((id) => id !== from);
    order.splice(order.indexOf(target), 0, from);
    this.store.setGuildOrder(order);
  }
}
