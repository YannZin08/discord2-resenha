import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { customEmojiUrl, customToken, emojiLabel, emojiSrc } from '../core/custom-emoji';
import { EmojiEntry, emojiCategories, emojiEntry, loadEmojis, searchEmojis, withSkin } from '../core/emoji';
import { twemojiUrl } from '../core/markdown';
import { Prefs } from '../core/prefs';
import { Store } from '../core/store';
import type { CustomEmoji } from '../core/types';
import { Ui } from '../core/ui';
import { Autofocus, Avatar, GuildIcon } from './shared';

export interface PickerRequest {
  x: number;
  y: number;
  /** Gets the emoji itself, or <:nome:id> for a server's custom emoji. */
  onPick: (emoji: string) => void;
  keepOpen?: boolean;
}

/** The hand that previews each skin tone in the tone menu. */
const TONE_HAND = ['✋', '✋🏻', '✋🏼', '✋🏽', '✋🏾', '✋🏿'];

interface Hover {
  src: string;
  label: string;
  sub?: string;
}

/** Global emoji picker popover (composer and reactions). Every emoji is free to use. */
@Component({
  selector: 'app-emoji-picker',
  imports: [FormsModule, Autofocus, Avatar, GuildIcon],
  template: `
    @if (req(); as r) {
      <div class="menu-backdrop" (mousedown)="close()"></div>
      <div class="emoji-picker" #el [style.left.px]="pos().x" [style.top.px]="pos().y">
        <div class="ep-search">
          <input class="input" placeholder="Encontre o emoji perfeito" [ngModel]="query()" (ngModelChange)="query.set($event)" appAutofocus />
          <div class="ep-tone">
            <button class="ep-tone-btn" title="Tom de pele" aria-label="Tom de pele" (click)="toneOpen.set(!toneOpen())"><img [src]="url(hands[tone()])" alt="" /></button>
            @if (toneOpen()) {
              <div class="ep-tone-menu">
                @for (h of hands; track $index) {
                  <button [class.active]="tone() === $index" (click)="setTone($index)"><img [src]="url(h)" alt="" /></button>
                }
              </div>
            }
          </div>
        </div>
        <div class="ep-body">
          <div class="ep-cats scroller thin">
            <button [class.active]="!query() && cat() === 'recent'" (click)="jump('recent')" title="Recentes">🕘</button>
            @for (g of customGroups(); track g.key) {
              <button class="ep-cat-guild" [class.active]="!query() && cat() === g.key" (click)="jump(g.key)" [title]="g.name">
                @if (g.mine) {
                  <app-avatar [user]="store.me()" [size]="28" />
                } @else {
                  <app-guild-icon [name]="g.name" [icon]="g.icon" [size]="28" />
                }
              </button>
            }
            @if (customGroups().length) {
              <span class="ep-cats-sep"></span>
            }
            @for (c of categories(); track c.id) {
              <button [class.active]="!query() && cat() === c.id" (click)="jump(c.id)" [title]="c.label"><img [src]="url(c.icon)" alt="" /></button>
            }
          </div>
          <div class="ep-grid scroller thin" #grid (scroll)="onScroll()">
            @if (query()) {
              <div class="ep-section">
                <div class="ep-title">Resultados</div>
                <div class="ep-items">
                  @for (e of customResults(); track e.id) {
                    <button (click)="pickCustom(e)" (mouseenter)="hoverCustom(e)"><img [src]="custom(e.id)" [alt]="e.name" loading="lazy" /></button>
                  }
                  @for (e of results(); track e.char) {
                    <button (click)="pick(skin(e))" (mouseenter)="hoverEmoji(e)"><img [src]="url(skin(e))" [alt]="e.char" loading="lazy" /></button>
                  }
                  @if (!results().length && !customResults().length) {
                    <div class="ep-empty">Nenhum emoji encontrado.</div>
                  }
                </div>
              </div>
            } @else {
              <div class="ep-section" data-cat="recent">
                <div class="ep-title">Usados recentemente</div>
                <div class="ep-items">
                  @for (e of recent(); track e) {
                    <button (click)="pick(e)" (mouseenter)="hoverRecent(e)"><img [src]="src(e)" [alt]="label(e)" /></button>
                  }
                </div>
              </div>
              @for (g of customGroups(); track g.key) {
                <div class="ep-section" [attr.data-cat]="g.key">
                  <div class="ep-title">{{ g.name }}</div>
                  <div class="ep-items">
                    @for (e of g.emojis; track e.id) {
                      <button (click)="pickCustom(e)" (mouseenter)="hoverCustom(e, g.name)"><img [src]="custom(e.id)" [alt]="e.name" loading="lazy" /></button>
                    }
                  </div>
                </div>
              }
              @for (c of categories(); track c.id) {
                <div class="ep-section" [attr.data-cat]="c.id">
                  <div class="ep-title">{{ c.label }}</div>
                  <div class="ep-items">
                    @for (e of c.emojis; track e.char) {
                      <button (click)="pick(skin(e))" (mouseenter)="hoverEmoji(e)"><img [src]="url(skin(e))" [alt]="e.char" loading="lazy" /></button>
                    }
                  </div>
                </div>
              }
            }
          </div>
        </div>
        <div class="ep-footer">
          @if (hover(); as h) {
            <img [src]="h.src" alt="" />
            <span>{{ h.label }}</span>
            @if (h.sub) {
              <small>{{ h.sub }}</small>
            }
          }
        </div>
      </div>
    }
  `,
})
export class EmojiPicker {
  private ui = inject(Ui);
  private prefs = inject(Prefs);
  readonly store = inject(Store);
  private el = viewChild<ElementRef<HTMLElement>>('el');
  private grid = viewChild<ElementRef<HTMLElement>>('grid');
  readonly categories = emojiCategories;
  readonly hands = TONE_HAND;
  readonly req = this.ui.picker;
  readonly query = signal('');
  readonly cat = signal('recent');
  readonly hover = signal<Hover | null>(null);
  readonly toneOpen = signal(false);
  readonly tone = computed(() => this.prefs.data().skinTone);
  readonly pos = signal({ x: 0, y: 0 });
  readonly results = computed(() => (this.categories(), searchEmojis(this.query())));
  readonly recent = computed(() => this.prefs.data().recentEmojis);

  /** My own emojis, then every server's, each in its own section — all of them usable. */
  readonly customGroups = computed(() => {
    const mine = this.store.myEmojis();
    return [
      ...(mine.length ? [{ key: 'mine', name: 'Seus emojis', icon: null, mine: true, emojis: mine }] : []),
      ...this.store
        .guildList()
        .filter((g) => g.emojis?.length)
        .map((g) => ({ key: 'g' + g.id, name: g.name, icon: g.icon, mine: false, emojis: g.emojis! })),
    ];
  });
  readonly customResults = computed(() => {
    const q = this.query().trim().toLowerCase().replace(/^:|:$/g, '');
    if (!q) return [];
    return this.store
      .customEmojis()
      .filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 40);
  });

  constructor() {
    effect(() => {
      const r = this.req();
      if (!r) return;
      void loadEmojis();
      this.query.set('');
      this.toneOpen.set(false);
      this.pos.set({ x: r.x, y: r.y });
      setTimeout(() => {
        const el = this.el()?.nativeElement;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        this.pos.set({
          x: Math.max(8, Math.min(r.x - rect.width, window.innerWidth - rect.width - 8)),
          y: Math.max(8, Math.min(r.y - rect.height - 8, window.innerHeight - rect.height - 8)),
        });
      });
    });
  }

  url(e: string) {
    return twemojiUrl(e);
  }

  src(e: string) {
    return emojiSrc(e);
  }

  label(e: string) {
    return emojiLabel(e);
  }

  custom(id: number) {
    return customEmojiUrl(id);
  }

  skin(e: EmojiEntry) {
    return withSkin(e, this.tone());
  }

  setTone(t: number) {
    this.prefs.set('skinTone', t);
    this.toneOpen.set(false);
  }

  hoverEmoji(e: EmojiEntry) {
    this.hover.set({ src: this.url(this.skin(e)), label: `:${e.name}:` });
  }

  hoverCustom(e: CustomEmoji & { guildId?: number | null }, from?: string) {
    const where = from ?? (e.guildId === null ? 'Seus emojis' : this.store.guilds()[e.guildId ?? 0]?.name);
    this.hover.set({ src: this.custom(e.id), label: `:${e.name}:`, sub: where ? (where === 'Seus emojis' ? where : `de ${where}`) : undefined });
  }

  hoverRecent(e: string) {
    const entry = emojiEntry(e);
    this.hover.set({ src: this.src(e), label: entry ? `:${entry.name}:` : this.label(e) });
  }

  pickCustom(e: CustomEmoji) {
    this.pick(customToken(e));
  }

  pick(e: string) {
    const r = this.req();
    this.prefs.useEmoji(e);
    r?.onPick(e);
    if (!r?.keepOpen) this.close();
  }

  close() {
    this.ui.picker.set(null);
  }

  jump(id: string) {
    this.query.set('');
    this.cat.set(id);
    setTimeout(() => {
      const target = this.grid()?.nativeElement.querySelector<HTMLElement>(`[data-cat="${id}"]`);
      if (target && this.grid()) this.grid()!.nativeElement.scrollTop = target.offsetTop - 4;
    });
  }

  onScroll() {
    const g = this.grid()?.nativeElement;
    if (!g) return;
    let current = 'recent';
    for (const s of g.querySelectorAll<HTMLElement>('[data-cat]')) if (s.offsetTop - 10 <= g.scrollTop) current = s.dataset['cat']!;
    this.cat.set(current);
  }
}
