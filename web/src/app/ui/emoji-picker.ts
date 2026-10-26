import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMOJI_CATEGORIES, EmojiEntry, searchEmojis } from '../core/emoji';
import { twemojiUrl } from '../core/markdown';
import { Prefs } from '../core/prefs';
import { Ui } from '../core/ui';
import { Autofocus } from './shared';

export interface PickerRequest {
  x: number;
  y: number;
  onPick: (emoji: string) => void;
  keepOpen?: boolean;
}

/** Global emoji picker popover (composer and reactions). */
@Component({
  selector: 'app-emoji-picker',
  imports: [FormsModule, Autofocus],
  template: `
    @if (req(); as r) {
      <div class="menu-backdrop" (mousedown)="close()"></div>
      <div class="emoji-picker" #el [style.left.px]="pos().x" [style.top.px]="pos().y">
        <div class="ep-search">
          <input class="input" placeholder="Encontre o emoji perfeito" [ngModel]="query()" (ngModelChange)="query.set($event)" appAutofocus />
        </div>
        <div class="ep-body">
          <div class="ep-cats">
            <button [class.active]="!query() && cat() === 'recent'" (click)="jump('recent')" title="Recentes">🕘</button>
            @for (c of categories; track c.id) {
              <button [class.active]="!query() && cat() === c.id" (click)="jump(c.id)" [title]="c.label"><img [src]="url(c.icon)" alt="" /></button>
            }
          </div>
          <div class="ep-grid scroller thin" #grid (scroll)="onScroll()">
            @if (query()) {
              <div class="ep-section">
                <div class="ep-title">Resultados</div>
                <div class="ep-items">
                  @for (e of results(); track e.char) {
                    <button (click)="pick(e.char)" (mouseenter)="hover.set(e)"><img [src]="url(e.char)" [alt]="e.char" loading="lazy" /></button>
                  } @empty {
                    <div class="ep-empty">Nenhum emoji encontrado.</div>
                  }
                </div>
              </div>
            } @else {
              <div class="ep-section" data-cat="recent">
                <div class="ep-title">Usados recentemente</div>
                <div class="ep-items">
                  @for (e of recent(); track e) {
                    <button (click)="pick(e)"><img [src]="url(e)" [alt]="e" /></button>
                  }
                </div>
              </div>
              @for (c of categories; track c.id) {
                <div class="ep-section" [attr.data-cat]="c.id">
                  <div class="ep-title">{{ c.label }}</div>
                  <div class="ep-items">
                    @for (e of c.emojis; track e.char) {
                      <button (click)="pick(e.char)" (mouseenter)="hover.set(e)"><img [src]="url(e.char)" [alt]="e.char" loading="lazy" /></button>
                    }
                  </div>
                </div>
              }
            }
          </div>
        </div>
        <div class="ep-footer">
          @if (hover(); as h) {
            <img [src]="url(h.char)" alt="" /> <span>:{{ h.name }}:</span>
          }
        </div>
      </div>
    }
  `,
})
export class EmojiPicker {
  private ui = inject(Ui);
  private prefs = inject(Prefs);
  private el = viewChild<ElementRef<HTMLElement>>('el');
  private grid = viewChild<ElementRef<HTMLElement>>('grid');
  readonly categories = EMOJI_CATEGORIES;
  readonly req = this.ui.picker;
  readonly query = signal('');
  readonly cat = signal('recent');
  readonly hover = signal<EmojiEntry | null>(null);
  readonly pos = signal({ x: 0, y: 0 });
  readonly results = computed(() => searchEmojis(this.query()));
  readonly recent = computed(() => this.prefs.data().recentEmojis);

  constructor() {
    effect(() => {
      const r = this.req();
      if (!r) return;
      this.query.set('');
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
