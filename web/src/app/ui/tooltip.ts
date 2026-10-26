import { Directive, ElementRef, HostListener, OnDestroy, inject, input } from '@angular/core';

/** Discord-style dark tooltip; appended to <body> so it is never clipped. */
@Directive({ selector: '[appTip]' })
export class Tip implements OnDestroy {
  readonly appTip = input<string | null | undefined>('');
  readonly tipSide = input<'right' | 'top' | 'bottom' | 'left'>('top');
  private el = inject<ElementRef<HTMLElement>>(ElementRef);
  private tip: HTMLDivElement | null = null;

  @HostListener('mouseenter')
  show() {
    const text = this.appTip();
    if (!text) return;
    this.hide();
    const tip = document.createElement('div');
    tip.className = `tooltip tooltip-${this.tipSide()}`;
    tip.textContent = text;
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
