import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Api } from '../core/api';
import { renderMarkdown } from '../core/markdown';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import type { User } from '../core/types';
import { MenuItem, Ui } from '../core/ui';
import { bannerImage, channelLabel, defaultAvatarColor, elapsedLabel } from '../core/util';
import { Voice } from '../core/voice';
import { userMenuItems } from './menus';
import { Avatar, Icon } from './shared';
import { Tip } from './tooltip';

/** Loaded when the card opens (GET /users/:id/profile). */
interface ProfileExtras {
  mutualFriends: User[];
  mutualGuilds: number[];
  badges: string[];
}

interface Badge {
  icon: string;
  label: string;
  color: string;
}

const BADGES: Record<string, Badge> = {
  owner: { icon: 'crown', label: 'Dono do servidor', color: '#f0b232' },
  pioneer: { icon: 'star', label: 'Pioneiro: uma das primeiras 100 contas do Resenha', color: '#5865f2' },
  botDev: { icon: 'code', label: 'Criador de bot', color: '#23a55a' },
};

/**
 * A person's profile, like Discord's popout: banner, status bubble, pronouns, badges,
 * friends and servers in common, the call they're in, and dates. The popout and the
 * profile settings preview both draw it; `preview` leaves out what needs the server.
 * The popout puts roles and the message box at the end (ng-content).
 */
@Component({
  selector: 'app-profile-card',
  imports: [Avatar, Icon, Tip],
  template: `
    @let u = user();
    <div
      class="profile-card"
      [class.themed]="!!theme()"
      [class.banner-image]="!!u.banner"
      [style.--profile-1]="theme()?.[0]"
      [style.--profile-2]="theme()?.[1]"
    >
      <div
        class="profile-banner"
        [class.has-image]="!!u.banner"
        [style.background-color]="u.bannerColor || theme()?.[0] || fallbackColor()"
        [style.background-image]="banner(u)"
      ></div>
      @if (!preview()) {
        <div class="profile-actions">
          @if (isMe()) {
            <button class="profile-action" appTip="Editar perfil" (click)="editProfile()"><app-icon name="edit" [size]="18" /></button>
          } @else if (!u.bot) {
            @if (canAddFriend()) {
              <button class="profile-action" appTip="Adicionar amigo" (click)="addFriend()"><app-icon name="personAdd" [size]="18" /></button>
            }
            <button class="profile-action" appTip="Mais" (click)="more($event)"><app-icon name="more" [size]="18" /></button>
          }
        </div>
      }
      <div class="profile-avatar">
        <app-avatar [user]="u" [size]="80" [status]="store.statusOf(u.id)" />
      </div>
      @if (u.customStatus) {
        <div class="profile-bubble"><span>{{ u.customStatus }}</span></div>
      }
      <div class="profile-body">
        <div class="profile-names">
          <div class="pn-display">
            {{ store.nameIn(guildId(), u.id) }}
            @if (u.bot) {
              <span class="bot-tag">BOT</span>
            }
          </div>
          <div class="pn-user">
            {{ u.username }}
            @if (u.pronouns) {
              <span class="pn-dot">•</span>{{ u.pronouns }}
            }
          </div>
        </div>
        @if (badges().length) {
          <div class="profile-badges">
            @for (b of badges(); track b.icon) {
              <span class="profile-badge" [style.color]="b.color" [appTip]="b.label"><app-icon [name]="b.icon" [size]="16" /></span>
            }
          </div>
        }
        @if (mutualText(); as text) {
          <button class="profile-mutuals" (click)="mutualsMenu($event)">
            @if (extras()?.mutualFriends?.length) {
              <span class="mutual-avatars">
                @for (f of extras()!.mutualFriends.slice(0, 3); track f.id) {
                  <app-avatar [user]="f" [size]="20" />
                }
              </span>
            }
            {{ text }}
          </button>
        }
        @if (u.about) {
          <div class="profile-section">
            <h3>Sobre mim</h3>
            <p class="profile-about" [innerHTML]="aboutHtml()"></p>
          </div>
        }
        @if (store.activityOf(u.id); as a) {
          <div class="profile-call profile-activity">
            <div class="pc-head">Jogando</div>
            <div class="pc-body">
              <span class="activity-icon small"><app-icon name="game" [size]="24" /></span>
              <div class="pc-text">
                <div class="pc-channel"><span>{{ a.name }}</span></div>
                <div class="pc-sub">{{ elapsed(a.since, store.now()) }}</div>
              </div>
            </div>
          </div>
        }
        @if (call(); as c) {
          <div class="profile-call">
            <div class="pc-head">{{ c.streaming ? 'Ao vivo' : 'Em voz' }}</div>
            <div class="pc-body">
              <div class="pc-avatars">
                @for (id of c.people.slice(0, 4); track id) {
                  <app-avatar [user]="store.users()[id]" [size]="c.people.length > 1 ? 28 : 40" />
                }
              </div>
              <div class="pc-text">
                <div class="pc-channel">
                  <app-icon name="speaker" [size]="16" />
                  <span>{{ c.name }}</span>
                  @if (c.streaming) {
                    <span class="live-badge">AO VIVO</span>
                  }
                </div>
                @if (c.place) {
                  <div class="pc-place">em {{ c.place }}</div>
                }
              </div>
            </div>
            @if (!preview()) {
              @if (c.here) {
                @if (c.streaming && !isMe()) {
                  <button class="btn btn-secondary pc-btn" (click)="watch(c.sessionId)">
                    {{ voice.watching() === c.sessionId ? 'Assistindo a transmissão' : 'Assistir transmissão' }}
                  </button>
                } @else {
                  <button class="btn btn-secondary pc-btn" disabled>Você está nesta chamada</button>
                }
              } @else {
                <button class="btn btn-secondary pc-btn" (click)="joinCall(c.channelId, c.guildId, c.streaming ? c.sessionId : null)">
                  {{ c.streaming && !isMe() ? 'Entrar e assistir' : 'Entrar na chamada de voz' }}
                </button>
              }
            }
          </div>
        }
        <div class="profile-section">
          <h3>Membro desde</h3>
          <div class="profile-dates">
            @let joined = joinedAt();
            @if (joined && date(joined) === date(u.createdAt)) {
              <span class="pd-item" appTip="No Resenha e neste servidor"><app-icon name="chat" [size]="14" />{{ date(u.createdAt) }}</span>
            } @else {
              <span class="pd-item" appTip="No Resenha"><app-icon name="chat" [size]="14" />{{ date(u.createdAt) }}</span>
              @if (joined) {
                <span class="pd-dot"></span>
                <span class="pd-item" appTip="Neste servidor"><app-icon name="group" [size]="14" />{{ date(joined) }}</span>
              }
            }
          </div>
        </div>
        <ng-content />
      </div>
    </div>
  `,
})
export class ProfileCard {
  readonly user = input.required<User>();
  readonly guildId = input<number | null>(null);
  /** The settings preview: no server data, no buttons. */
  readonly preview = input(false);

  readonly store = inject(Store);
  readonly elapsed = elapsedLabel;
  readonly voice = inject(Voice);
  private ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);
  private sanitizer = inject(DomSanitizer);

  readonly banner = bannerImage;
  readonly extras = signal<ProfileExtras | null>(null);
  /** "Sobre mim" with the chat's formatting: clickable links, **bold**, emojis, mentions. */
  readonly aboutHtml = computed<SafeHtml>(() => {
    const gid = this.guildId();
    const html = renderMarkdown(this.user().about, {
      userName: (id) => (this.store.users()[id] ? this.store.nameIn(gid, id) : null),
      channelName: (id) => this.store.channels()[id]?.name ?? null,
      meId: this.store.me()?.id,
    });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });
  readonly isMe = computed(() => this.user().id === this.store.me()?.id);
  readonly theme = computed(() => this.user().themeColors ?? null);
  readonly fallbackColor = computed(() => defaultAvatarColor(this.user().id));
  readonly canAddFriend = computed(() => !this.store.relationships()[this.user().id]);
  readonly joinedAt = computed(() => {
    const gid = this.guildId();
    return gid != null ? (this.store.member(gid, this.user().id)?.joinedAt ?? null) : null;
  });

  readonly badges = computed<Badge[]>(() => {
    const out: Badge[] = [];
    const gid = this.guildId();
    if (gid != null && this.store.isOwner(gid, this.user().id)) out.push(BADGES['owner']);
    for (const b of this.extras()?.badges ?? []) if (BADGES[b]) out.push(BADGES[b]);
    return out;
  });

  readonly mutualText = computed(() => {
    const x = this.extras();
    if (!x || this.isMe()) return '';
    const parts: string[] = [];
    const f = x.mutualFriends.length;
    const g = x.mutualGuilds.length;
    if (f) parts.push(`${f} ${f === 1 ? 'amigo mútuo' : 'amigos mútuos'}`);
    if (g) parts.push(`${g} ${g === 1 ? 'servidor mútuo' : 'servidores mútuos'}`);
    return parts.join(' • ');
  });

  /** The call this person is in, if it's one we can see. */
  readonly call = computed(() => {
    const id = this.user().id;
    const v = Object.values(this.store.voiceStates()).find((s) => s.userId === id && s.channelId != null);
    if (!v || v.channelId == null) return null;
    const ch = this.store.channels()[v.channelId];
    if (!ch) return null;
    const guild = ch.guildId != null ? this.store.guilds()[ch.guildId] : null;
    return {
      channelId: v.channelId,
      guildId: ch.guildId,
      sessionId: v.sessionId,
      streaming: v.stream,
      name: guild ? ch.name : channelLabel(ch, this.store.users(), this.store.me()?.id),
      place: guild?.name ?? (ch.guildId == null ? 'mensagens diretas' : ''),
      people: this.store.voiceIn(v.channelId).map((s) => s.userId),
      here: this.voice.channelId() === v.channelId,
    };
  });

  constructor() {
    effect((onCleanup) => {
      const id = this.user().id;
      if (this.preview()) return;
      let alive = true;
      onCleanup(() => (alive = false));
      this.extras.set(null);
      // Only extra details: if this fails, the card just shows less.
      this.api
        .get<ProfileExtras>(`/users/${id}/profile`)
        .then((x) => alive && this.extras.set(x))
        .catch(() => undefined);
    });
  }

  /** Short like Discord's ("26 de out. de 2026"), so a date and its label fit on one line. */
  /** Short date, "26 out. 2026" (without pt-BR's "de"s). */
  date(ts: number) {
    return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/ de /g, ' ');
  }

  async editProfile() {
    // Imported on demand: the settings screen itself shows this card as its preview.
    const { UserSettings } = await import('./modals/user-settings');
    this.ui.closeMenus();
    this.ui.open(UserSettings, { start: 'profile' });
  }

  addFriend() {
    this.api
      .post('/relationships', { username: this.user().username })
      .then(() => this.ui.toast(`Pedido de amizade enviado para ${this.user().displayName}.`, 'success'))
      .catch((e) => this.ui.error(e));
  }

  more(e: MouseEvent) {
    e.stopPropagation();
    const keep = this.ui.profile();
    const items = userMenuItems(this.user().id, this.guildId(), { store: this.store, ui: this.ui, api: this.api, nav: this.nav, voice: this.voice });
    // "Perfil" would just reopen this card.
    this.ui.openMenuAt(e.currentTarget as Element, items.filter((i) => i.label !== 'Perfil'), 'below');
    this.ui.profile.set(keep);
  }

  mutualsMenu(e: MouseEvent) {
    e.stopPropagation();
    const x = this.extras();
    if (!x) return;
    const anchor = e.currentTarget as Element;
    const keep = this.ui.profile();
    const items: MenuItem[] = [];
    if (x.mutualFriends.length) {
      items.push({
        label: 'Amigos em comum',
        submenu: x.mutualFriends.map((f) => ({ label: f.displayName, hint: f.username, action: () => this.ui.openProfile(f.id, null, anchor) })),
      });
    }
    if (x.mutualGuilds.length) {
      items.push({
        label: 'Servidores em comum',
        submenu: x.mutualGuilds.map((gid) => ({ label: this.store.guilds()[gid]?.name ?? 'Servidor', action: () => this.openGuild(gid) })),
      });
    }
    this.ui.openMenuAt(anchor, items, 'below');
    this.ui.profile.set(keep);
  }

  private openGuild(gid: number) {
    const ch = this.nav.lastChannel(gid) ?? this.store.guildChannels(gid).find((c) => c.type === 'text')?.id;
    if (ch != null) this.nav.openChannel(gid, ch);
    this.ui.closeMenus();
  }

  /** Joins without leaving the chat you're in; only watching a stream opens the call screen. */
  joinCall(channelId: number, guildId: number | null, stream: string | null) {
    this.ui.closeMenus();
    if (stream) {
      this.nav.openChannel(guildId, channelId);
      void this.voice.watchStream(stream);
    } else {
      void this.voice.join(channelId, guildId);
    }
  }

  watch(sessionId: string) {
    const c = this.call();
    this.ui.closeMenus();
    if (c) this.nav.openChannel(c.guildId, c.channelId);
    if (this.voice.watching() !== sessionId) void this.voice.watchStream(sessionId);
  }
}
