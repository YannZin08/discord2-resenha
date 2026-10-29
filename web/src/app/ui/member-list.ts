import { Component, computed, inject, input } from '@angular/core';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import type { Channel, User } from '../core/types';
import { Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { userMenuItems } from './menus';
import { Avatar, Icon } from './shared';
import { Tip } from './tooltip';

interface Section {
  key: string;
  title: string;
  users: User[];
  offline?: boolean;
}

@Component({
  selector: 'app-member-list',
  imports: [Avatar, Icon, Tip],
  template: `
    <aside class="member-list scroller thin">
      @for (s of sections(); track s.key) {
        <h3 class="member-section">{{ s.title }} — {{ s.users.length }}</h3>
        @for (u of s.users; track u.id) {
          <div class="member" [class.offline]="s.offline" (click)="profile($event, u)" (contextmenu)="menu($event, u)">
            <app-avatar [user]="u" [size]="32" [status]="store.statusOf(u.id)" />
            <div class="member-text">
              <div class="member-name" [style.color]="color(u.id)">
                <span>{{ store.nameIn(guildId(), u.id) }}</span>
                @if (u.bot) {
                  <span class="bot-tag">BOT</span>
                }
                @if (isOwner(u.id)) {
                  <app-icon class="owner-crown" name="crown" [size]="14" appTip="Dono do servidor" />
                }
              </div>
              @if (store.activityOf(u.id); as a) {
                <div class="member-status activity-line">Jogando <strong>{{ a.name }}</strong></div>
              } @else if (u.customStatus && !s.offline) {
                <div class="member-status">{{ u.customStatus }}</div>
              }
            </div>
          </div>
        }
      }
    </aside>
  `,
})
export class MemberList {
  readonly channel = input.required<Channel>();
  readonly store = inject(Store);
  readonly voice = inject(Voice);
  private ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);

  readonly guildId = computed(() => this.channel().guildId);

  readonly sections = computed<Section[]>(() => {
    const c = this.channel();
    const users = this.store.users();
    const gid = c.guildId;
    const ids = gid != null ? Object.keys(this.store.members()[gid] ?? {}).map(Number) : (c.recipients ?? []);
    const list = ids.map((id) => users[id]).filter((u): u is User => !!u);
    const byName = (a: User, b: User) => this.store.nameIn(gid, a.id).localeCompare(this.store.nameIn(gid, b.id), 'pt-BR');
    const online = list.filter((u) => this.store.statusOf(u.id) !== 'offline').sort(byName);
    const offline = list.filter((u) => this.store.statusOf(u.id) === 'offline').sort(byName);
    const out: Section[] = [];
    let rest = online;
    if (gid != null) {
      // Hoisted roles get their own group, highest role first.
      for (const r of (this.store.roles()[gid] ?? []).filter((x) => x.hoist)) {
        const inRole = rest.filter((u) => this.topHoisted(gid, u.id) === r.id);
        if (inRole.length) out.push({ key: 'r' + r.id, title: r.name, users: inRole });
        rest = rest.filter((u) => !inRole.includes(u));
      }
    }
    if (rest.length) out.push({ key: 'online', title: gid != null ? 'Online' : 'Membros', users: rest });
    if (offline.length) out.push({ key: 'offline', title: 'Offline', users: offline, offline: true });
    return out;
  });

  private topHoisted(gid: number, uid: number): number | null {
    const m = this.store.member(gid, uid);
    if (!m) return null;
    const r = (this.store.roles()[gid] ?? []).filter((x) => x.hoist && m.roles.includes(x.id)).sort((a, b) => b.position - a.position)[0];
    return r?.id ?? null;
  }

  color(uid: number) {
    return this.store.colorIn(this.guildId(), uid);
  }

  isOwner(uid: number) {
    const c = this.channel();
    return c.guildId != null ? this.store.isOwner(c.guildId, uid) : c.ownerId === uid;
  }

  profile(e: MouseEvent, u: User) {
    this.ui.openProfile(u.id, this.guildId(), e.currentTarget as Element);
  }

  menu(e: MouseEvent, u: User) {
    const el = e.currentTarget as Element;
    this.ui.openMenu(e, userMenuItems(u.id, this.guildId(), { store: this.store, ui: this.ui, api: this.api, nav: this.nav, voice: this.voice }, el));
  }
}
