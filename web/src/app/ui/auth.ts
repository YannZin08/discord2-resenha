import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Nav } from '../core/nav';
import { Session } from '../core/session';
import { APP_NAME } from '../core/util';
import { Autofocus, Logo } from './shared';

@Component({
  selector: 'app-auth',
  imports: [FormsModule, Logo, Autofocus],
  template: `
    <div class="auth-bg">
      <form class="auth-card" (ngSubmit)="submit()">
        <div class="auth-brand"><app-logo [size]="40" /> {{ appName }}</div>
        @if (mode() === 'login') {
          <h1>Boas-vindas de volta!</h1>
          <p class="auth-sub">Estamos muito animados em te ver novamente!</p>
        } @else {
          <h1>Criar uma conta</h1>
          <p class="auth-sub">Leva só um minutinho.</p>
        }

        <label class="field-label" [class.error]="error()">
          Nome de usuário <span class="req">*</span>
          @if (error()) {
            <span class="field-error"> - {{ error() }}</span>
          }
        </label>
        <input class="input" name="username" [(ngModel)]="username" autocomplete="username" appAutofocus required />

        @if (mode() === 'register') {
          <label class="field-label">Nome de exibição</label>
          <input class="input" name="displayName" [(ngModel)]="displayName" placeholder="Como as pessoas vão te ver" />
        }

        <label class="field-label">Senha <span class="req">*</span></label>
        <input
          class="input"
          type="password"
          name="password"
          [(ngModel)]="password"
          [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
          required
        />

        <button class="btn btn-brand btn-block" type="submit" [disabled]="busy()">
          {{ busy() ? 'Aguarde...' : mode() === 'login' ? 'Entrar' : 'Continuar' }}
        </button>

        @if (mode() === 'login') {
          <p class="auth-switch">Precisando de uma conta? <a (click)="switch('register')">Registre-se</a></p>
        } @else {
          <p class="auth-switch"><a (click)="switch('login')">Já tem uma conta?</a></p>
        }
      </form>
    </div>
  `,
})
export class Auth {
  private session = inject(Session);
  private nav = inject(Nav);
  readonly appName = APP_NAME;
  // On the invite page the URL stays /invite/..., so the mode can't come from the route.
  private readonly forced = signal<'login' | 'register' | null>(null);
  readonly mode = computed(() => this.forced() ?? (this.nav.route().name === 'register' ? 'register' : 'login'));
  readonly busy = signal(false);
  readonly error = signal('');
  username = '';
  displayName = '';
  password = '';

  switch(mode: 'login' | 'register') {
    this.error.set('');
    if (this.nav.route().name === 'invite') {
      this.forced.set(mode);
      return;
    }
    this.nav.go('/' + mode);
  }

  async submit() {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      if (this.mode() === 'login') await this.session.login(this.username, this.password);
      else await this.session.register(this.username, this.displayName, this.password);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
