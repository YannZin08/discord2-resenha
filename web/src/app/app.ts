import { Component, HostListener, computed, effect, inject } from '@angular/core';
import { loadEmojis } from './core/emoji';
import { Nav } from './core/nav';
import { Prefs } from './core/prefs';
import { Session } from './core/session';
import { applyTheme } from './core/themes';
import { Store } from './core/store';
import { Ui } from './core/ui';
import { Auth } from './ui/auth';
import { InvitePage } from './ui/invite-page';
import { EmojiPicker } from './ui/emoji-picker';
import { MusicPlayer } from './ui/music-player';
import { SoundboardPanel } from './ui/soundboard-panel';
import { CallRing, ContextMenu, Lightbox, ModalHost, ProfilePopout, Toasts } from './ui/overlays';
import { Logo } from './ui/shared';
import { Shell } from './ui/shell';

const TIPS = [
  'Dica: segure Shift e aperte Enter para pular uma linha.',
  'Dica: clique com o botão direito em quase tudo para ver mais opções.',
  'Dica: use Ctrl+K para achar canais e conversas rapidinho.',
  'Dica: arraste arquivos para o chat para enviá-los.',
  'Dica: aperte seta para cima para editar sua última mensagem.',
  'Dica: escreva ||assim|| para esconder um spoiler.',
];

@Component({
  selector: 'app-root',
  imports: [Auth, InvitePage, Shell, Logo, ContextMenu, ProfilePopout, ModalHost, Toasts, Lightbox, CallRing, EmojiPicker, MusicPlayer, SoundboardPanel],
  template: `
    @switch (view()) {
      @case ('loading') {
        <div class="splash">
          <app-logo [size]="72" />
          <div class="splash-tip">{{ tip }}</div>
        </div>
      }
      @case ('invite') {
        <app-invite-page />
      }
      @case ('auth') {
        <app-auth />
      }
      @case ('app') {
        <app-shell />
      }
    }
    <app-modal-host />
    <app-context-menu />
    <app-profile-popout />
    <app-soundboard />
    <app-emoji-picker />
    <app-lightbox />
    <app-music-player />
    <app-call-ring />
    <app-toasts />
  `,
})
export class App {
  private session = inject(Session);
  private store = inject(Store);
  private nav = inject(Nav);
  private ui = inject(Ui);
  private prefs = inject(Prefs);
  readonly tip = TIPS[Math.floor(Math.random() * TIPS.length)];

  readonly view = computed(() => {
    const status = this.session.status();
    const route = this.nav.route().name;
    if (route === 'invite' && status !== 'checking') return 'invite';
    if (status === 'checking') return 'loading';
    if (status === 'out') return 'auth';
    return this.store.ready() ? 'app' : 'loading';
  });

  constructor() {
    void this.session.init();
    effect(() => applyTheme(this.prefs.data().theme, this.prefs.data().chatFont, this.prefs.data().accent));
    // The full emoji list (for :nomes: and the picker) comes in once the app is open.
    effect(() => {
      if (this.store.ready()) void loadEmojis();
    });
    effect(() => {
      document.documentElement.dataset['motion'] = this.prefs.data().reduceMotion ? 'reduced' : 'full';
    });
    effect(() => {
      const status = this.session.status();
      const route = this.nav.route().name;
      if (status === 'out' && route === 'app') this.nav.go('/login', true);
      if (status === 'in' && (route === 'login' || route === 'register')) this.nav.go('/channels/@me', true);
    });
    // Twemoji images fall back to the native emoji if the CDN is unreachable.
    document.addEventListener(
      'error',
      (e) => {
        const img = e.target as HTMLImageElement;
        if (img?.tagName === 'IMG' && img.classList.contains('emoji')) img.replaceWith(document.createTextNode(img.alt));
      },
      true,
    );
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (this.ui.menu() || this.ui.profile()) this.ui.closeMenus();
      else if (this.ui.lightbox()) this.ui.lightbox.set(null);
      else if (this.ui.modals().length) this.ui.close();
      else if (this.ui.panel()) this.ui.panel.set(null);
    }
  }
}
