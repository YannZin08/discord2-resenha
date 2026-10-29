import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Api } from '../core/api';
import { emojiSrc } from '../core/custom-emoji';
import { renderMarkdown } from '../core/markdown';
import { Nav } from '../core/nav';
import { PROFILE_REACTIONS, SELOS, linkLabel, profileOf, statusLine } from '../core/profile';
import { Store } from '../core/store';
import type { User } from '../core/types';
import { MenuItem, Ui } from '../core/ui';
import { channelLabel, defaultAvatarColor, elapsedLabel, fileUrl } from '../core/util';
import { Voice } from '../core/voice';
import { userMenuItems } from './menus';
import { Avatar, Icon } from './shared';
import { Tip } from './tooltip';

interface ReactionCount {
  kind: string;
  count: number;
  mine: boolean;
}

/** Loaded when the card opens (GET /users/:id/profile). */
interface ProfileExtras {
  mutualFriends: User[];
  mutualGuilds: number[];
  badges: string[];
  reactions?: ReactionCount[];
}

/**
 * A person's profile: their little corner of the Resenha. Banner (GIF or picture) under a
 * shade that keeps the text readable, status line, "vibe" tag, Minha resenha, link,
 * interests, selos and what people say about them; then the call they're in and dates.
 * Two looks (card, immersive); sections with nothing in them don't show.
 * The popout and the profile settings preview both draw it; `preview` drops the buttons.
 * The popout puts roles and the message box at the end (ng-content).
 */
@Component({
  selector: 'app-profile-card',
  imports: [Avatar, Icon, Tip],
  template: `
    @let u = user();
    @let p = prof();
    <div
      class="profile-card"
      [attr.data-style]="p.style"
      [class.themed]="!!theme()"
      [class.banner-image]="!!u.banner"
      [style.--profile-1]="theme()?.[0]"
      [style.--profile-2]="theme()?.[1]"
      [style.--shade]="shade()"
    >
      <div class="profile-banner" [class.has-image]="!!u.banner" [style.background-color]="u.bannerColor || theme()?.[0] || fallbackColor()">
        @if (u.banner) {
          <img class="profile-banner-img" [src]="bannerSrc(u.banner)" alt="" draggable="false" (load)="measure($event)" />
          <div class="profile-banner-shade"></div>
        }
      </div>
      @if (!preview()) {
        <div class="profile-actions">
          @if (isMe()) {
            <button class="profile-action" appTip="Editar perfil" (click)="editProfile()"><app-icon name="edit" [size]="18" /></button>
          } @else if (!u.bot) {
            @if (canReact()) {
              <button class="profile-action" appTip="Reagir ao perfil" (click)="reactMenu($event)"><app-icon name="addReaction" [size]="18" /></button>
            }
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
          @if (status(); as s) {
            <div class="profile-status" [style.--status-color]="s.color">
              @if (s.emoji) {
                <img class="emoji" [src]="emoji(s.emoji)" alt="" />
              } @else {
                <i class="ps-dot"></i>
              }
              <span>{{ s.text }}</span>
            </div>
          }
          @if (p.vibe; as v) {
            <span class="profile-vibe" [style.--vibe]="v.color">
              @if (v.emoji) {
                <img class="emoji" [src]="emoji(v.emoji)" alt="" />
              }
              <b>{{ v.label }}:</b> {{ v.text }}
            </span>
          }
        </div>
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
            <h3>Minha resenha</h3>
            <p class="profile-about" [innerHTML]="aboutHtml()"></p>
          </div>
        }
        @if (p.link) {
          <a class="profile-link" [href]="p.link" target="_blank" rel="noopener noreferrer nofollow">
            <app-icon name="link" [size]="16" /><span>{{ linkText() }}</span>
          </a>
        }
        @if (interests().length) {
          <div class="profile-section">
            <h3>Interesses</h3>
            <div class="profile-tags">
              @for (t of interests(); track t) {
                <span class="profile-tag">{{ t }}</span>
              }
            </div>
          </div>
        }
        @if (selos().length) {
          <div class="profile-section">
            <h3>Selos</h3>
            <div class="profile-selos">
              @for (s of selos(); track s.label) {
                <span class="profile-selo" [style.--selo]="s.color" [appTip]="s.hint"><app-icon [name]="s.icon" [size]="14" />{{ s.label }}</span>
              }
            </div>
          </div>
        }
        @if (reactions().length && (p.privacy.reactions || isMe())) {
          <div class="profile-section">
            <h3>A galera diz</h3>
            <div class="profile-reactions">
              @for (r of reactions(); track r.kind) {
                <button
                  class="profile-reaction"
                  [class.mine]="r.mine"
                  [disabled]="!canReact() && !r.mine"
                  [appTip]="r.mine ? 'Tirar a sua reação' : canReact() ? 'Reagir também' : r.label"
                  (click)="toggleReaction(r.kind, !r.mine)"
                >
                  <img class="emoji" [src]="emoji(r.emoji)" alt="" />{{ r.label }}<span>{{ r.count }}</span>
                </button>
              }
            </div>
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
        @if (!compact() && call(); as c) {
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
        @if (!compact() && p.privacy.joined) {
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
        }
        <ng-content />
      </div>
    </div>
  `,
})
export class ProfileCard {
  readonly user = input.required<User>();
  readonly guildId = input<number | null>(null);
  /** The settings preview: no buttons (it still loads your own selos and reactions). */
  readonly preview = input(false);
  /** Opened from the call list: leaves out the call card and "Membro desde". */
  readonly compact = input(false);

  readonly store = inject(Store);
  readonly elapsed = elapsedLabel;
  readonly voice = inject(Voice);
  private ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);
  private sanitizer = inject(DomSanitizer);

  readonly extras = signal<ProfileExtras | null>(null);
  readonly prof = computed(() => profileOf(this.user()));
  readonly status = computed(() => statusLine(this.user()));
  readonly linkText = computed(() => linkLabel(this.prof().link ?? ''));
  readonly interests = computed(() => this.prof().interests);
  /** Banner brightness (0–1) measured when it loads; drives the automatic shade. */
  private brightness = signal<number | null>(null);
  /** How dark the shade over the banner is: the person's choice, or more for bright pictures. */
  readonly shade = computed(() => {
    const p = this.prof();
    const base = p.overlay != null ? p.overlay / 100 : 0.15 + (this.brightness() ?? 0.5) * 0.45;
    // The immersive look puts the name on the picture: never too light there.
    return String(p.style === 'immersive' ? Math.max(base, 0.3) : base);
  });
  /** "Minha resenha" with the chat's formatting: clickable links, **bold**, emojis, mentions. */
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

  /** Selos, each with its word: the server's founder, then what the server says they earned. */
  readonly selos = computed(() => {
    const gid = this.guildId();
    const keys = [...(gid != null && this.store.isOwner(gid, this.user().id) ? ['owner'] : []), ...(this.extras()?.badges ?? [])];
    return keys.filter((k) => SELOS[k]).map((k) => SELOS[k]);
  });

  /** Only the kinds they received, with labels. */
  readonly reactions = computed(() =>
    (this.extras()?.reactions ?? []).map((r) => ({ ...r, ...PROFILE_REACTIONS.find((x) => x.kind === r.kind)! })).filter((r) => r.label),
  );
  readonly canReact = computed(() => !this.preview() && !this.isMe() && !this.user().bot && this.prof().privacy.reactions);

  emoji(e: string) {
    return emojiSrc(e);
  }

  bannerSrc(key: string) {
    return fileUrl(key, 'banner');
  }

  /** Average brightness of the banner's first frame, on a tiny canvas (same-origin files). */
  measure(e: Event) {
    try {
      const img = e.target as HTMLImageElement;
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, 8, 8);
      const d = g.getImageData(0, 0, 8, 8).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      this.brightness.set(sum / (d.length / 4));
    } catch {
      // can't read the picture: the middle shade is fine
    }
  }

  reactMenu(e: MouseEvent) {
    e.stopPropagation();
    const keep = this.ui.profile();
    const given = new Set(this.reactions().filter((r) => r.mine).map((r) => r.kind));
    this.ui.openMenuAt(
      e.currentTarget as Element,
      PROFILE_REACTIONS.map((r) => ({ label: `${r.emoji}  ${r.label}`, checked: given.has(r.kind), action: () => this.toggleReaction(r.kind, !given.has(r.kind)) })),
      'below',
    );
    this.ui.profile.set(keep);
  }

  toggleReaction(kind: string, on: boolean) {
    const id = this.user().id;
    const req = on ? this.api.put<{ reactions: ReactionCount[] }>(`/users/${id}/reactions/${kind}`, {}) : this.api.delete<{ reactions: ReactionCount[] }>(`/users/${id}/reactions/${kind}`);
    req.then((r) => this.extras.update((x) => (x ? { ...x, reactions: r.reactions } : x))).catch((err) => this.ui.error(err));
  }

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
