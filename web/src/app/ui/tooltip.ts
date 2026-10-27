import { Directive, ElementRef, HostListener, OnDestroy, inject, input } from '@angular/core';
import type { User } from '../core/types';
import { avatarUrl, defaultAvatarColor, initials } from '../core/util';
import { ICONS } from './shared';

/** At most this many faces in a tooltip's "in a call" row; the rest become "+N". */
const MAX_FACES = 6;

/** Discord-style dark tooltip; appended to <body> so it is never clipped. */
@Directive({ selector: '[appTip]' })
export class Tip implements OnDestroy {
  readonly appTip = input<string | null | undefined>('');
  readonly tipSide = input<'right' | 'top' | 'bottom' | 'left'>('top');
  /** People in a call, shown under the text with a speaker (the server list uses it). */
  readonly tipVoice = input<User[] | null>(null);
  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  private tip: HTMLDivElement | null = null;

  @HostListener('mouseenter')
  show() {
    const text = this.appTip();
    if (!text) return;
    this.hide();
    const tip = document.createElement('div');
    tip.className = `tooltip tooltip-${this.tipSide()}`;
    const voice = this.tipVoice();
    if (voice?.length) {
      tip.classList.add('tooltip-rich');
      const title = document.createElement('div');
      title.className = 'tip-title';
      title.textContent = text;
      tip.append(title, this.voiceRow(voice));
    } else {
      tip.textContent = text;
    }
    document.body.appendChild(tip);
    const r = this.el.nativeElement.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x: number;
    let y: number;
    switch (this.tipSide()) {
      case 'right':
        x = r.right + 12;
        y = r.top + r.height / 2 - t.height / 2;
        break;
      case 'left':
        x = r.left - t.width - 12;
        y = r.top + r.height / 2 - t.height / 2;
        break;
      case 'bottom':
        x = r.left + r.width / 2 - t.width / 2;
        y = r.bottom + 8;
        break;
      default:
        x = r.left + r.width / 2 - t.width / 2;
        y = r.top - t.height - 8;
    }
    tip.style.left = Math.max(4, Math.min(x, window.innerWidth - t.width - 4)) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
    this.tip = tip;
  }

  /** Speaker icon and the faces of who's in the call, like Discord's server tooltip. */
  private voiceRow(users: User[]): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'tip-voice';
    row.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${ICONS['speaker']}"/></svg>`;
    const faces = document.createElement('div');
    faces.className = 'tip-faces';
    for (const u of users.slice(0, MAX_FACES)) {
      const url = avatarUrl(u);
      const face = document.createElement(url ? 'img' : 'span');
      face.className = 'tip-face';
      if (face instanceof HTMLImageElement) face.src = url!;
      else {
        face.style.background = defaultAvatarColor(u.id);
        face.textContent = initials(u.displayName).slice(0, 1).toUpperCase();
      }
      faces.append(face);
    }
    if (users.length > MAX_FACES) {
      const more = document.createElement('span');
      more.className = 'tip-face tip-more';
      more.textContent = `+${users.length - MAX_FACES}`;
      faces.append(more);
    }
    row.append(faces);
    return row;
  }

  @HostListener('mouseleave')
  @HostListener('mousedown')
  hide() {
    this.tip?.remove();
    this.tip = null;
  }

  ngOnDestroy() {
    this.hide();
  }
}
