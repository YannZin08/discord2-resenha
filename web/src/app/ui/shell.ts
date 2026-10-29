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
    fitToKeyboard();
    effect(() => {
      this.nav.path();
      this.ui.mobileNav.set(false);
      this.ui.mobileMembers.set(false);
    });
  }

  /** Swipes on phones, like Discord's app: right opens the channels, left the member list. */
  private swipe: { x: number; y: number; time: number; target: EventTarget | null } | null = null;

  @HostListener('document:touchstart', ['$event'])
  onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    this.swipe = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, time: Date.now(), target: e.target } : null;
  }

  @HostListener('document:touchend', ['$event'])
  onTouchEnd(e: TouchEvent) {
    const s = this.swipe;
    this.swipe = null;
    const ui = this.ui;
    if (!s || !ui.narrow() || ui.modals().length || ui.menu() || ui.profile() || ui.picker() || ui.soundboard()) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - s.time > 700) return;
    if (s.target instanceof Element && (s.target.closest('input, textarea, video, .no-swipe') || scrollsSideways(s.target))) return;
    if (dx > 0) {
      if (ui.mobileMembers()) ui.mobileMembers.set(false);
      else if (ui.mobile()) ui.mobileNav.set(true);
    } else if (ui.mobileNav()) {
      ui.mobileNav.set(false);
    } else if (this.hasMembers()) {
      ui.mobileMembers.set(true);
    }
  }

  private readonly hasMembers = computed(() => {
    const c = this.channel();
    return !!c && (c.type === 'text' || c.type === 'group_dm');
  });

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!this.ui.modals().some((m) => m.component === QuickSwitcher)) this.ui.open(QuickSwitcher);
    }
  }
}

/** Whether a touch on `el` belongs to something that scrolls sideways (tabs, emoji rows…). */
function scrollsSideways(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

/**
 * Phones' on-screen keyboard covers the page instead of resizing it (iOS), so the app follows
 * the visible area: the composer stays above the keyboard.
 */
function fitToKeyboard() {
  const vv = window.visualViewport;
  if (!vv || !matchMedia('(hover: none)').matches) return;
  const fit = () => {
    if (Math.abs(vv.scale - 1) > 0.01) return; // pinch zoom, not the keyboard
    document.documentElement.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
    if (window.scrollY) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  fit();
}
