import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { emojiSrc } from '../core/custom-emoji';
import { Prefs } from '../core/prefs';
import { Soundboard } from '../core/soundboard';
import { Store } from '../core/store';
import type { Sound } from '../core/types';
import { Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { GuildSettings } from './modals/guild-settings';
import { UserSettings } from './modals/user-settings';
import { Autofocus, Avatar, GuildIcon, Icon } from './shared';
import { Tip } from './tooltip';

interface Group {
  key: string;
  name: string;
  icon: string | null;
  mine: boolean;
  sounds: Sound[];
}

/** Soundboard popover: every sound you can play (yours and all your servers'), no limits. */
@Component({
  selector: 'app-soundboard',
  imports: [FormsModule, Autofocus, Avatar, GuildIcon, Icon, Tip],
  template: `
    @if (ui.soundboard(); as r) {
      <div class="menu-backdrop" (mousedown)="close()"></div>
      <div class="soundboard" #el [style.left.px]="pos().x" [style.top.px]="pos().y">
        <div class="sb-head">
          <input class="input" placeholder="Buscar efeito sonoro" [ngModel]="query()" (ngModelChange)="query.set($event)" appAutofocus />
        </div>
        <div class="sb-body scroller thin">
          @if (voice.deaf()) {
            <div class="sb-note">Seu áudio está desativado. Ative para usar os efeitos sonoros.</div>
          } @else if (!voice.channelId()) {
            <div class="sb-note">Entre em uma chamada para tocar os sons para todo mundo. Aqui você ainda pode ouvi-los só para você.</div>
          }
          @for (g of groups(); track g.key) {
            <div class="sb-section">
              <div class="sb-title">
                @if (g.mine) {
                  <app-avatar [user]="store.me()" [size]="16" />
                } @else {
                  <app-guild-icon [name]="g.name" [icon]="g.icon" [size]="16" />
                }
                <span>{{ g.name }}</span>
              </div>
              <div class="sb-grid">
                @for (s of g.sounds; track s.id) {
                  <div class="sb-sound" [class.playing]="board.playing().has(s.id)">
                    <button class="sb-play" [disabled]="!voice.channelId() || voice.deaf()" (click)="board.play(s)" [title]="s.name">
                      @if (s.emoji) {
                        <img class="sb-emoji" [src]="emoji(s.emoji)" alt="" />
                      }
                      <span>{{ s.name }}</span>
                    </button>
                    <button class="sb-preview" [appTip]="board.playing().has(s.id) ? 'Parar' : 'Ouvir só para você'" (click)="board.preview(s)">
                      <app-icon [name]="board.playing().has(s.id) ? 'stop' : 'play'" [size]="14" />
                    </button>
                  </div>
                }
              </div>
            </div>
          } @empty {
            <div class="sb-empty">
              <span>🔊</span>
              <p>{{ query() ? 'Nenhum som encontrado.' : 'Nenhum efeito sonoro ainda. Envie os seus ou os do servidor: aqui não tem limite.' }}</p>
            </div>
          }
        </div>
        <div class="sb-foot">
          <button class="btn btn-secondary small" (click)="addMine()">Meus sons</button>
          @if (manageGuild(); as g) {
            <button class="btn btn-secondary small" (click)="addGuild(g)">Sons do servidor</button>
          }
          <label class="sb-vol" appTip="Volume dos efeitos sonoros">
            <app-icon name="speaker" [size]="16" />
            <input type="range" min="0" max="100" [value]="prefs.data().soundboardVolume" (input)="prefs.set('soundboardVolume', +$any($event.target).value)" />
          </label>
        </div>
      </div>
    }
  `,
})
export class SoundboardPanel {
  readonly ui = inject(Ui);
  readonly store = inject(Store);
  readonly voice = inject(Voice);
  readonly prefs = inject(Prefs);
  readonly board = inject(Soundboard);
  private el = viewChild<ElementRef<HTMLElement>>('el');
  readonly query = signal('');
  readonly pos = signal({ x: 0, y: 0 });

  /** The call's server first, then my own sounds, then every other server. */
  readonly groups = computed<Group[]>(() => {
    const here = this.voice.guildId();
    const guilds = this.store.guildList().filter((g) => g.sounds?.length);
    const toGroup = (g: (typeof guilds)[number]): Group => ({ key: 'g' + g.id, name: g.name, icon: g.icon, mine: false, sounds: g.sounds! });
    const mine = this.store.mySounds();
    const all: Group[] = [
      ...guilds.filter((g) => g.id === here).map(toGroup),
      ...(mine.length ? [{ key: 'mine', name: 'Seus sons', icon: null, mine: true, sounds: mine }] : []),
      ...guilds.filter((g) => g.id !== here).map(toGroup),
    ];
    const q = this.query().trim().toLowerCase();
    if (!q) return all;
    return all.map((g) => ({ ...g, sounds: g.sounds.filter((s) => s.name.toLowerCase().includes(q)) })).filter((g) => g.sounds.length);
  });

  /** The call's server, when I can manage its sounds. */
  readonly manageGuild = computed(() => {
    const gid = this.voice.guildId();
    return gid != null && this.store.isAdmin(gid) ? gid : null;
  });

  constructor() {
    effect(() => {
      const r = this.ui.soundboard();
      if (!r) return;
      this.query.set('');
      this.pos.set({ x: r.x, y: r.y });
      setTimeout(() => {
        const el = this.el()?.nativeElement;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        this.pos.set({
          x: Math.max(8, Math.min(r.x - rect.width / 2, window.innerWidth - rect.width - 8)),
          y: Math.max(8, r.y - rect.height - 8),
        });
      });
    });
  }

  emoji(e: string) {
    return emojiSrc(e);
  }

  addMine() {
    this.close();
    this.ui.open(UserSettings, { start: 'sounds' });
  }

  addGuild(gid: number) {
    this.close();
    this.ui.open(GuildSettings, { guildId: gid, start: 'sounds' });
  }

  close() {
    this.ui.soundboard.set(null);
  }
}
