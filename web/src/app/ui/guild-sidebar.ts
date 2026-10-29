import { Component, computed, inject, input } from '@angular/core';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Prefs } from '../core/prefs';
import { Store } from '../core/store';
import type { Channel, VoiceState } from '../core/types';
import { Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { channelMenuItems, guildMenuItems, userMenuItems } from './menus';
import { ChannelSettings, CreateChannel } from './modals/channel-modals';
import { InviteModal } from './modals/invite';
import { Avatar, Icon } from './shared';
import { Tip } from './tooltip';

interface Group {
  category: Channel | null;
  channels: Channel[];
}

@Component({
  selector: 'app-guild-sidebar',
  imports: [Icon, Avatar, Tip],
  template: `
    @if (guild(); as g) {
      <header class="sidebar-header guild-header" (click)="headerMenu($event)">
        <span class="guild-header-name">{{ g.name }}</span>
        <app-icon name="chevronDown" [size]="18" />
      </header>
      <div class="channel-list scroller thin" (contextmenu)="listMenu($event)">
        @if (liveCall(); as call) {
          <div class="live-call">
            <div class="live-call-head">
              <span class="live-call-title">Na call agora</span>
              <span class="live-call-name">{{ call.channel.name }}</span>
            </div>
            <div class="live-call-row">
              <button class="live-call-faces" [attr.aria-label]="'Ver a call ' + call.channel.name" (click)="nav.openChannel(call.channel.guildId, call.channel.id)">
                @for (v of call.faces; track v.sessionId) {
                  <app-avatar [user]="store.users()[v.userId]" [size]="32" [speaking]="voice.speaking().has(v.userId)" />
                }
                @if (call.more) {
                  <span class="live-call-more">+{{ call.more }}</span>
                }
              </button>
              <button class="live-call-join" (click)="voice.join(call.channel.id, call.channel.guildId)">Entrar</button>
            </div>
          </div>
        }
        @for (group of groups(); track group.category?.id ?? 0) {
          @if (group.category; as cat) {
            <div class="category" [class.collapsed]="isCollapsed(cat.id)" (click)="toggle(cat.id)" (contextmenu)="channelMenu($event, cat)">
              <app-icon name="chevronDown" [size]="12" />
              <span class="category-name">{{ cat.name }}</span>
              @if (admin()) {
                <button class="category-add" appTip="Criar canal" (click)="create($event, cat)"><app-icon name="plus" [size]="18" /></button>
              }
            </div>
          }
          @for (c of group.channels; track c.id) {
            @if (!group.category || !isCollapsed(group.category.id) || isActive(c) || store.isUnread(c) || voiceUsers(c.id).length) {
              <div
                class="channel"
                [class.active]="isActive(c)"
                [class.unread]="store.isUnread(c) && !isActive(c)"
                [class.connected]="voice.channelId() === c.id"
                (click)="open(c)"
                (contextmenu)="channelMenu($event, c)"
              >
                <span class="channel-unread-pill"></span>
                <app-icon class="channel-icon" [name]="c.type === 'voice' ? 'speaker' : 'hash'" [size]="20" />
                <span class="channel-name">{{ c.name }}</span>
                <span class="channel-actions">
                  <button appTip="Criar convite" (click)="invite($event)"><app-icon name="personAdd" [size]="16" /></button>
                  @if (admin()) {
                    <button appTip="Editar canal" (click)="edit($event, c)"><app-icon name="gear" [size]="16" /></button>
                  }
                </span>
                @if (store.mentionCount(c.id); as n) {
                  <span class="badge">{{ n }}</span>
                }
              </div>
              @if (c.type === 'voice') {
                <div class="voice-users">
                  @for (v of voiceUsers(c.id); track v.sessionId) {
                    <div class="voice-user" (click)="profile($event, v)" (contextmenu)="userMenu($event, v)">
                      <app-avatar [user]="store.users()[v.userId]" [size]="24" [speaking]="voice.speaking().has(v.userId)" />
                      <span class="voice-user-name" [class.speaking]="voice.speaking().has(v.userId)">{{ store.nameIn(g.id, v.userId) }}</span>
                      @if (v.bot) {
                        <span class="bot-tag">BOT</span>
                      }
                      @if (v.stream) {
                        <span class="live-badge" [appTip]="v.sessionId === store.sessionId() ? 'Você está transmitindo' : 'Assistir transmissão'" (click)="watchStream($event, v)">AO VIVO</span>
                      }
                      @if (v.video) {
                        <app-icon name="video" [size]="16" />
                      }
                      @if (v.deaf) {
                        <app-icon class="red" name="headsetOff" [size]="16" />
                      } @else if (v.mute) {
                        <app-icon class="red" name="micOff" [size]="16" />
                      }
                    </div>
                  }
                </div>
              }
            }
          }
        }
      </div>
    }
  `,
})
export class GuildSidebar {
  readonly guildId = input.required<number>();
  readonly store = inject(Store);
  readonly nav = inject(Nav);
  readonly ui = inject(Ui);
  readonly voice = inject(Voice);
  private api = inject(Api);
  private prefs = inject(Prefs);

  readonly guild = computed(() => this.store.guilds()[this.guildId()]);
  readonly admin = computed(() => this.store.isAdmin(this.guildId()));

  readonly groups = computed<Group[]>(() => {
    const all = this.store.guildChannels(this.guildId());
    const byType = (a: Channel, b: Channel) => (a.type === b.type ? 0 : a.type === 'voice' ? 1 : -1) || a.position - b.position || a.id - b.id;
    const loose = all.filter((c) => c.type !== 'category' && (c.parentId == null || !all.some((x) => x.id === c.parentId))).sort(byType);
    const groups: Group[] = [];
    if (loose.length) groups.push({ category: null, channels: loose });
    for (const cat of all.filter((c) => c.type === 'category')) {
      groups.push({ category: cat, channels: all.filter((c) => c.parentId === cat.id).sort(byType) });
    }
    return groups;
  });

  /** The busiest call of the server you're not in, with a shortcut to join it. */
  readonly liveCall = computed(() => {
    let best: { channel: Channel; users: VoiceState[] } | null = null;
    for (const c of this.store.guildChannels(this.guildId())) {
      if (c.type !== 'voice' || c.id === this.voice.channelId()) continue;
      const users = this.store.voiceIn(c.id);
      if (users.length && (!best || users.length > best.users.length)) best = { channel: c, users };
    }
    if (!best) return null;
    return { channel: best.channel, faces: best.users.slice(0, 4), more: Math.max(0, best.users.length - 4) };
  });

  voiceUsers(channelId: number): VoiceState[] {
    return this.store.voiceIn(channelId);
  }

  isActive(c: Channel) {
    return this.nav.channelId() === c.id;
  }

  isCollapsed(id: number) {
    return !!this.prefs.get('collapsed')[id];
  }

  toggle(id: number) {
    const c = { ...this.prefs.get('collapsed') };
    if (c[id]) delete c[id];
    else c[id] = true;
    this.prefs.set('collapsed', c);
  }

  /**
   * A voice channel you're not in: just join the call and stay in the chat you're reading.
   * Clicking it again once connected opens the call screen.
   */
  open(c: Channel) {
    if (c.type === 'voice' && this.voice.channelId() !== c.id) {
      void this.voice.join(c.id, c.guildId);
      return;
    }
    this.nav.openChannel(c.guildId, c.id);
  }

  headerMenu(e: MouseEvent) {
    const g = this.guild();
    if (!g) return;
    this.ui.openMenuAt(e.currentTarget as Element, guildMenuItems(g, this.store, this.ui, this.api, this.nav));
  }

  listMenu(e: MouseEvent) {
    if (!this.admin() || e.target !== e.currentTarget) return;
    this.ui.openMenu(e, [
      { label: 'Criar canal', action: () => this.ui.open(CreateChannel, { guildId: this.guildId() }) },
      { label: 'Criar categoria', action: () => this.ui.open(CreateChannel, { guildId: this.guildId(), category: true }) },
      { label: 'Convidar pessoas', action: () => this.ui.open(InviteModal, { guildId: this.guildId() }) },
    ]);
  }

  channelMenu(e: MouseEvent, c: Channel) {
    this.ui.openMenu(e, channelMenuItems(c, this.store, this.ui, this.api));
  }

  create(e: MouseEvent, cat: Channel) {
    e.stopPropagation();
    this.ui.open(CreateChannel, { guildId: this.guildId(), parentId: cat.id });
  }

  invite(e: MouseEvent) {
    e.stopPropagation();
    this.ui.open(InviteModal, { guildId: this.guildId() });
  }

  edit(e: MouseEvent, c: Channel) {
    e.stopPropagation();
    this.ui.open(ChannelSettings, { channelId: c.id });
  }

  profile(e: MouseEvent, v: VoiceState) {
    e.stopPropagation();
    this.ui.openProfile(v.userId, this.guildId(), e.currentTarget as Element);
  }

  /** Clicking someone's "AO VIVO" opens their stream, like in Discord. */
  watchStream(e: MouseEvent, v: VoiceState) {
    e.stopPropagation();
    if (v.channelId == null || v.sessionId === this.store.sessionId()) return;
    void this.voice.watchStream(v.sessionId);
    this.nav.openChannel(this.guildId(), v.channelId);
  }

  userMenu(e: MouseEvent, v: VoiceState) {
    const el = e.currentTarget as Element;
    this.ui.openMenu(e, userMenuItems(v.userId, this.guildId(), { store: this.store, ui: this.ui, api: this.api, nav: this.nav, voice: this.voice }, el));
  }
}
