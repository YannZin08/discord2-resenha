import { Component, HostListener, computed, effect, inject } from '@angular/core';
import { Gateway } from '../core/gateway';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import { Ui } from '../core/ui';
import { Chat } from './chat';
import { DmSidebar } from './dm-sidebar';
import { Friends } from './friends';
import { GuildSidebar } from './guild-sidebar';
import { QuickSwitcher } from './modals/quick-switcher';
import { ServerRail } from './server-rail';
import { UserPanel } from './user-panel';
import { VoiceRoom } from './voice-room';

@Component({
  selector: 'app-shell',
  imports: [ServerRail, GuildSidebar, DmSidebar, UserPanel, Chat, Friends, VoiceRoom],
  template: `
    <div class="shell" [class.nav-open]="ui.mobileNav()">
      @if (gateway.state() === 'reconnecting') {
        <div class="conn-banner">Conexão perdida. Reconectando...</div>
      }
      <div class="layout">
        <div class="nav-col">
          <app-server-rail />
          <div class="sidebar">
            @if (guildId(); as gid) {
              <app-guild-sidebar [guildId]="gid" />
            } @else {
              <app-dm-sidebar />
            }
            <app-user-panel />
          </div>
        </div>
        <main class="main">
          @if (channel(); as c) {
            @if (c.type === 'voice') {
              <app-voice-room [channel]="c" />
            } @else {
              <app-chat [channel]="c" />
            }
          } @else if (!guildId()) {
            <app-friends />
          } @else {
            <div class="empty-main">
              <div class="empty-art">#</div>
              <p>Nenhum canal de texto por aqui ainda.</p>
            </div>
          }
        </main>
      </div>
      <div class="nav-scrim" (click)="ui.mobileNav.set(false)"></div>
    </div>
  `,
})
export class Shell {
  readonly store = inject(Store);
  readonly nav = inject(Nav);
  readonly ui = inject(Ui);
  readonly gateway = inject(Gateway);

  readonly guildId = computed(() => {
    const id = this.nav.guildId();
    return id != null && this.store.guilds()[id] ? id : null;
  });

  readonly channel = computed(() => {
    const id = this.nav.channelId();
    const c = id != null ? this.store.channels()[id] : undefined;
    if (!c || c.type === 'category') return null;
    if ((c.guildId ?? null) !== this.guildId()) return null;
    return c;
  });

  constructor() {
    // Keep the URL pointing at something that exists.
    effect(() => {
      if (!this.store.ready()) return;
      const gid = this.nav.guildId();
      const cid = this.nav.channelId();
      const channels = this.store.channels();
      if (gid != null) {
        if (!this.store.guilds()[gid]) return this.nav.home();
        const c = cid != null ? channels[cid] : undefined;
        if (!c || c.guildId !== gid || c.type === 'category') {
          const last = this.nav.lastChannel(gid);
          const list = this.store.guildChannels(gid);
          const pick =
            (last && channels[last]?.guildId === gid && channels[last].type === 'text' ? channels[last] : null) ??
            list.find((x) => x.id === this.store.guilds()[gid].systemChannelId) ??
            list.find((x) => x.type === 'text');
          if (pick) this.nav.go(`/channels/${gid}/${pick.id}`, true);
          else if (cid != null) this.nav.go(`/channels/${gid}`, true);
        }
      } else if (cid != null && (!channels[cid] || channels[cid].guildId != null)) {
        this.nav.go('/channels/@me', true);
      }
    });
    effect(() => {
      this.nav.path();
      this.ui.mobileNav.set(false);
    });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!this.ui.modals().some((m) => m.component === QuickSwitcher)) this.ui.open(QuickSwitcher);
    }
  }
}
