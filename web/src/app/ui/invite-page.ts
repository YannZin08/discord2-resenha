import { Component, computed, effect, inject, signal } from '@angular/core';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Session } from '../core/session';
import type { InviteInfo } from '../core/types';
import { Auth } from './auth';
import { Avatar, GuildIcon } from './shared';

@Component({
  selector: 'app-invite-page',
  imports: [Auth, GuildIcon, Avatar],
  template: `
    <div class="auth-bg">
      <div class="invite-stack">
        <div class="auth-card invite-card">
          @if (info(); as inv) {
            <div class="invite-guild-icon"><app-guild-icon [name]="inv.guild.name" [icon]="inv.guild.icon" [size]="64" /></div>
            @if (inv.inviter) {
              <div class="invite-inviter">
                <app-avatar [user]="inv.inviter" [size]="20" /> {{ inv.inviter.displayName }} convidou você para entrar em
              </div>
            } @else {
              <div class="invite-inviter">Você foi convidado para entrar em</div>
            }
            <h1>{{ inv.guild.name }}</h1>
            <div class="invite-counts">
              <span><i class="dot online"></i>{{ inv.guild.onlineCount }} online</span>
              <span><i class="dot"></i>{{ inv.guild.memberCount }} {{ inv.guild.memberCount === 1 ? 'membro' : 'membros' }}</span>
            </div>
            @if (loggedIn()) {
              <button class="btn btn-brand btn-block" (click)="accept()" [disabled]="busy()">
                {{ busy() ? 'Entrando...' : 'Aceitar convite' }}
              </button>
              <p class="auth-switch"><a (click)="nav.home()">Agora não</a></p>
            }
          } @else if (error()) {
            <h1>Convite inválido</h1>
            <p class="auth-sub">{{ error() }}</p>
            <button class="btn btn-brand btn-block" (click)="nav.home()">Continuar para o app</button>
          } @else {
            <div class="spinner"></div>
          }
        </div>
        @if (!loggedIn() && info()) {
          <app-auth />
        }
      </div>
    </div>
  `,
})
export class InvitePage {
  private api = inject(Api);
  private session = inject(Session);
  readonly nav = inject(Nav);
  readonly info = signal<InviteInfo | null>(null);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly loggedIn = computed(() => this.session.status() === 'in');
  readonly code = computed(() => {
    const r = this.nav.route();
    return r.name === 'invite' ? r.code : '';
  });

  constructor() {
    effect(() => {
      const code = this.code();
      if (!code) return;
      this.api
        .get<InviteInfo>(`/invites/${encodeURIComponent(code)}`)
        .then((i) => this.info.set(i))
        .catch((e) => this.error.set(e.message));
    });
  }

  async accept() {
    this.busy.set(true);
    try {
      const r = await this.api.post<{ guildId: number }>(`/invites/${encodeURIComponent(this.code())}`);
      this.nav.go(`/channels/${r.guildId}`);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      this.info.set(null);
    } finally {
      this.busy.set(false);
    }
  }
}
