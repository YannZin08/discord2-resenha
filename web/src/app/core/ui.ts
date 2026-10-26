import { Injectable, Type, signal } from '@angular/core';
import { save, store } from './util';

export interface MenuItem {
  label?: string;
  hint?: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
  color?: string;
  action?: () => void;
  submenu?: MenuItem[];
  slider?: { value: number; min: number; max: number; onInput: (v: number) => void; format?: (v: number) => string };
}

export interface ModalEntry {
  id: number;
  component: Type<unknown>;
  inputs: Record<string, unknown>;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

export interface ProfilePopout {
  userId: number;
  guildId: number | null;
  x: number;
  y: number;
  side: 'right' | 'left';
}

let seq = 0;

@Injectable({ providedIn: 'root' })
export class Ui {
  readonly modals = signal<ModalEntry[]>([]);
  readonly menu = signal<{ x: number; y: number; items: MenuItem[] } | null>(null);
  readonly profile = signal<ProfilePopout | null>(null);
  readonly toasts = signal<Toast[]>([]);
  readonly lightbox = signal<{ src: string; name: string; video?: boolean } | null>(null);
  readonly picker = signal<{ x: number; y: number; onPick: (emoji: string) => void; keepOpen?: boolean } | null>(null);
  readonly memberList = signal<boolean>(store('memberList', true));
  readonly mobileNav = signal(false);
  readonly mobileMembers = signal(false);
  readonly panel = signal<'pins' | 'search' | null>(null);
  readonly searchQuery = signal('');

  open<T>(component: Type<T>, inputs: Record<string, unknown> = {}): number {
    const id = ++seq;
    this.closeMenus();
    this.modals.update((m) => [...m, { id, component: component as Type<unknown>, inputs }]);
    return id;
  }

  close(id?: number) {
    this.modals.update((m) => (id == null ? m.slice(0, -1) : m.filter((x) => x.id !== id)));
  }

  openMenu(e: MouseEvent | { x: number; y: number }, items: MenuItem[]) {
    if ('preventDefault' in e) {
      e.preventDefault();
      e.stopPropagation();
    }
    this.profile.set(null);
    this.menu.set({ x: e.x, y: e.y, items });
  }

  openMenuAt(el: Element, items: MenuItem[], align: 'below' | 'right' = 'below') {
    const r = el.getBoundingClientRect();
    this.openMenu(align === 'below' ? { x: r.left, y: r.bottom + 6 } : { x: r.right + 8, y: r.top }, items);
  }

  openProfile(userId: number, guildId: number | null, anchor: Element | MouseEvent) {
    let x: number;
    let y: number;
    let side: 'right' | 'left' = 'right';
    if ('getBoundingClientRect' in anchor) {
      const r = anchor.getBoundingClientRect();
      if (r.right + 320 > window.innerWidth) {
        side = 'left';
        x = r.left - 16;
      } else {
        x = r.right + 16;
      }
      y = r.top;
    } else {
      anchor.stopPropagation();
      x = anchor.x + 16;
      y = anchor.y;
      if (x + 320 > window.innerWidth) {
        side = 'left';
        x = anchor.x - 16;
      }
    }
    this.menu.set(null);
    this.profile.set({ userId, guildId, x, y, side });
  }

  closeMenus() {
    this.menu.set(null);
    this.profile.set(null);
    this.picker.set(null);
  }

  openPicker(anchor: Element, onPick: (emoji: string) => void, keepOpen = false) {
    const r = anchor.getBoundingClientRect();
    this.menu.set(null);
    this.profile.set(null);
    this.picker.set({ x: r.right, y: r.top, onPick, keepOpen });
  }

  toast(text: string, kind: Toast['kind'] = 'info') {
    const id = ++seq;
    this.toasts.update((t) => [...t, { id, text, kind }]);
    setTimeout(() => this.toasts.update((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 3000);
  }

  error(e: unknown) {
    this.toast(e instanceof Error ? e.message : String(e), 'error');
  }

  toggleMemberList() {
    this.memberList.update((v) => !v);
    save('memberList', this.memberList());
  }
}
