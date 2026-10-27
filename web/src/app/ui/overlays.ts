import { NgComponentOutlet } from '@angular/common';
import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Session } from '../core/session';
import { Store } from '../core/store';
import type { Channel, Message } from '../core/types';
import { MenuItem, Ui } from '../core/ui';
import { bannerImage, defaultAvatarColor, formatLongDate, uid } from '../core/util';
import { Avatar, Icon } from './shared';

@Component({
  selector: 'app-menu-list',
  imports: [Icon],
  template: `
    @for (item of items(); track $index) {
      @if (item.separator) {
        <div class="menu-sep"></div>
      } @else if (item.slider; as s) {
        <div class="menu-slider" (mousedown)="$event.stopPropagation()">
          <div class="menu-slider-label">{{ item.label }}</div>
          <input type="range" [min]="s.min" [max]="s.max" [value]="s.value" (input)="slide(item, $event)" />
          <div class="menu-slider-value">{{ s.format ? s.format(sliderValue(item)) : sliderValue(item) }}</div>
        </div>
      } @else {
        <div
          class="menu-item"
          [class.danger]="item.danger"
          [class.disabled]="item.disabled"
          [class.has-sub]="!!item.submenu"
          (mouseenter)="hovered.set($index)"
          (mouseleave)="hovered.set(-1)"
          (click)="run(item, $event)"
        >
          @if (item.color) {
            <i class="menu-color" [style.background]="item.color"></i>
          }
          <span class="menu-label">{{ item.label }}</span>
          @if (item.hint) {
            <span class="menu-hint">{{ item.hint }}</span>
          }
          @if (item.checked !== undefined) {
            <span class="menu-check" [class.on]="item.checked">
              @if (item.checked) {
                <app-icon name="check" [size]="14" />
              }
            </span>
          } @else if (item.submenu) {
            <app-icon name="chevronRight" [size]="18" />
          } @else if (item.icon) {
            <app-icon [name]="item.icon" [size]="18" />
          }
          @if (item.submenu && hovered() === $index) {
            <div class="menu submenu"><app-menu-list [items]="item.submenu" /></div>
          }
        </div>
      }
    }
  `,
})
export class MenuList {
  private ui = inject(Ui);
  readonly items = input.required<MenuItem[]>();
  readonly hovered = signal(-1);
  private sliderValues = new Map<MenuItem, number>();

  run(item: MenuItem, e: MouseEvent) {
    e.stopPropagation();
    if (item.disabled || item.submenu) return;
    if (item.checked === undefined) this.ui.closeMenus();
    item.action?.();
    if (item.checked !== undefined) item.checked = !item.checked;
  }

  sliderValue(item: MenuItem) {
    return this.sliderValues.get(item) ?? item.slider!.value;
  }

  slide(item: MenuItem, e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    this.sliderValues.set(item, v);
    item.slider!.onInput(v);
  }
}

@Component({
  selector: 'app-context-menu',
  imports: [MenuList],
  template: `
    @if (ui.menu(); as m) {
      <div class="menu-backdrop" (mousedown)="ui.closeMenus()" (contextmenu)="$event.preventDefault(); ui.closeMenus()"></div>
      <div class="menu" #el [style.left.px]="pos().x" [style.top.px]="pos().y" (contextmenu)="$event.preventDefault()">
        <app-menu-list [items]="m.items" />
      </div>
    }
  `,
})
export class ContextMenu {
  readonly ui = inject(Ui);
  private el = viewChild<ElementRef<HTMLElement>>('el');
  readonly pos = signal({ x: 0, y: 0 });

  constructor() {
    effect(() => {
      const m = this.ui.menu();
      if (!m) return;
      this.pos.set({ x: m.x, y: m.y });
      setTimeout(() => {
        const el = this.el()?.nativeElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const x = Math.max(8, Math.min(m.x, window.innerWidth - r.width - 8));
        const y = Math.max(8, Math.min(m.y, window.innerHeight - r.height - 8));
        this.pos.set({ x, y });
      });
    });
  }
}

@Component({
  selector: 'app-profile-popout',
  imports: [Avatar, Icon, FormsModule],
  template: `
    @if (ui.profile(); as p) {
      @if (user(); as u) {
        <div class="menu-backdrop" (mousedown)="ui.closeMenus()"></div>
        <div class="profile-popout" #el [style.left.px]="pos().x" [style.top.px]="pos().y">
          <div
            class="profile-banner"
            [class.has-image]="!!u.banner"
            [style.background-color]="u.bannerColor || bannerFallback()"
            [style.background-image]="banner(u)"
          ></div>
          <div class="profile-avatar">
            <app-avatar [user]="u" [size]="80" [status]="store.statusOf(u.id)" />
          </div>
          <div class="profile-body">
            <div class="profile-names">
              <div class="pn-display">
                {{ store.nameIn(p.guildId, u.id) }}
                @if (u.bot) {
                  <span class="bot-tag">BOT</span>
                }
              </div>
              <div class="pn-user">{{ u.username }}</div>
            </div>
            @if (u.customStatus) {
              <div class="profile-custom-status">{{ u.customStatus }}</div>
            }
            <div class="profile-divider"></div>
            @if (u.about) {
              <div class="profile-section">
                <h3>Sobre mim</h3>
                <p class="profile-about">{{ u.about }}</p>
              </div>
            }
            <div class="profile-section">
              <h3>Membro desde</h3>
              <p>{{ since(u.createdAt) }}</p>
            </div>
            @if (p.guildId != null && store.member(p.guildId, u.id); as m) {
              <div class="profile-section">
                <h3>{{ m.roles.length ? 'Cargos' : 'Sem cargos' }}</h3>
                <div class="role-pills">
                  @for (r of memberRoles(); track r.id) {
                    <span class="role-pill">
                      <i class="role-dot" [style.background]="r.color || '#99aab5'" (click)="admin() && removeRole(r.id)"
                        >@if (admin()) {
                          <app-icon name="close" [size]="10" />
                        }</i
                      >
                      {{ r.name }}
                    </span>
                  }
                  @if (admin() && addableRoles().length) {
                    <button class="role-add" (click)="addRoleMenu($event)" title="Adicionar cargo"><app-icon name="plus" [size]="14" /></button>
                  }
                </div>
              </div>
            }
            @if (u.id !== store.me()?.id) {
              <input
                class="input profile-message"
                [placeholder]="'Mensagem para @' + u.username"
                [(ngModel)]="draft"
                (keydown.enter)="sendDm(u.id)"
              />
            }
          </div>
        </div>
      }
    }
  `,
})
export class ProfilePopout {
  readonly ui = inject(Ui);
  readonly store = inject(Store);
  private api = inject(Api);
  private nav = inject(Nav);
  private el = viewChild<ElementRef<HTMLElement>>('el');
  readonly pos = signal({ x: 0, y: 0 });
  draft = '';

  readonly user = computed(() => {
    const p = this.ui.profile();
    return p ? this.store.users()[p.userId] : null;
  });
  readonly bannerFallback = computed(() => defaultAvatarColor(this.user()?.id ?? 0));
  readonly banner = bannerImage;
  readonly admin = computed(() => this.store.isAdmin(this.ui.profile()?.guildId));
  readonly memberRoles = computed(() => {
    const p = this.ui.profile();
    if (!p || p.guildId == null) return [];
    const m = this.store.member(p.guildId, p.userId);
    return (this.store.roles()[p.guildId] ?? []).filter((r) => m?.roles.includes(r.id));
  });
  readonly addableRoles = computed(() => {
    const p = this.ui.profile();
    if (!p || p.guildId == null) return [];
    const m = this.store.member(p.guildId, p.userId);
    return (this.store.roles()[p.guildId] ?? []).filter((r) => !m?.roles.includes(r.id));
  });

  constructor() {
    effect(() => {
      const p = this.ui.profile();
      if (!p) return;
      this.draft = '';
      this.pos.set({ x: p.side === 'left' ? p.x - 300 : p.x, y: p.y });
      setTimeout(() => {
        const el = this.el()?.nativeElement;
        if (!el) return;
        const r = el.getBoundingClientRect();
        this.pos.set({
          x: Math.max(8, Math.min(p.side === 'left' ? p.x - r.width : p.x, window.innerWidth - r.width - 8)),
          y: Math.max(8, Math.min(p.y, window.innerHeight - r.height - 8)),
        });
      });
    });
  }

  since(ts: number) {
    return formatLongDate(ts);
  }

  private setRoles(roles: number[]) {
    const p = this.ui.profile()!;
    this.api.patch(`/guilds/${p.guildId}/members/${p.userId}`, { roles }).catch((e) => this.ui.error(e));
  }

  removeRole(roleId: number) {
    const p = this.ui.profile()!;
    const m = this.store.member(p.guildId, p.userId);
    if (m) this.setRoles(m.roles.filter((r) => r !== roleId));
  }

  addRoleMenu(e: MouseEvent) {
    const p = this.ui.profile()!;
    const m = this.store.member(p.guildId, p.userId);
    const keep = this.ui.profile();
    this.ui.menu.set({
      x: e.x,
      y: e.y,
      items: this.addableRoles().map((r) => ({
        label: r.name,
        color: r.color || '#99aab5',
        action: () => {
          this.setRoles([...(m?.roles ?? []), r.id]);
          this.ui.profile.set(keep);
        },
      })),
    });
  }

  async sendDm(userId: number) {
    const text = this.draft.trim();
    try {
      const ch = await this.api.post<Channel>('/dms', { recipients: [userId] });
      if (text) await this.api.post<Message>(`/channels/${ch.id}/messages`, { content: text, nonce: uid() });
      this.ui.closeMenus();
      this.nav.openChannel(null, ch.id);
    } catch (e) {
      this.ui.error(e);
    }
  }
}

@Component({
  selector: 'app-modal-host',
  imports: [NgComponentOutlet],
  template: `
    @for (m of ui.modals(); track m.id) {
      <div class="modal-layer">
        <ng-container *ngComponentOutlet="m.component; inputs: m.inputs" />
      </div>
    }
  `,
})
export class ModalHost {
  readonly ui = inject(Ui);
}

@Component({
  selector: 'app-toasts',
  template: `
    <div class="toasts">
      @for (t of ui.toasts(); track t.id) {
        <div class="toast toast-{{ t.kind }}">{{ t.text }}</div>
      }
    </div>
  `,
})
export class Toasts {
  readonly ui = inject(Ui);
}

@Component({
  selector: 'app-lightbox',
  template: `
    @if (ui.lightbox(); as l) {
      <div class="lightbox" (click)="ui.lightbox.set(null)">
        <div class="lightbox-inner" (click)="$event.stopPropagation()">
          @if (l.video) {
            <video [src]="l.src" controls autoplay></video>
          } @else {
            <img [src]="l.src" [alt]="l.name" />
          }
          <a class="lightbox-link" [href]="l.src" target="_blank" rel="noopener">Abrir no navegador</a>
        </div>
      </div>
    }
  `,
})
export class Lightbox {
  readonly ui = inject(Ui);
}

@Component({
  selector: 'app-call-ring',
  imports: [Avatar, Icon],
  template: `
    @if (session.ringing(); as r) {
      <div class="call-ring">
        <app-avatar [user]="store.users()[r.userId]" [size]="80" />
        <div class="call-ring-name">{{ store.nameIn(null, r.userId) }}</div>
        <div class="call-ring-sub">Chamada recebida...</div>
        <div class="call-ring-actions">
          <button class="round-btn danger" title="Recusar" (click)="session.dismissCall()"><app-icon name="hangup" /></button>
          <button class="round-btn success" title="Atender" (click)="session.acceptCall()"><app-icon name="phone" /></button>
        </div>
      </div>
    }
  `,
})
export class CallRing {
  readonly session = inject(Session);
  readonly store = inject(Store);
}
