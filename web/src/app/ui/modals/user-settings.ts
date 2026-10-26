import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Prefs } from '../../core/prefs';
import { Session } from '../../core/session';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { Voice } from '../../core/voice';
import { avatarUrl, defaultAvatarColor } from '../../core/util';
import { Avatar, Icon } from '../shared';
import { confirmDialog, promptDialog } from './dialogs';
import { StreamOptions } from './go-live';
import { pickImage, squareImage } from './image';
import { StreamSettings } from '../../core/prefs';
import { THEMES } from '../../core/themes';

type Section = 'account' | 'profile' | 'appearance' | 'voice' | 'stream' | 'notifications';

const BANNERS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459f', '#1abc9c', '#9b59b6', '#34495e', '#e67e22', '#2c3e50'];

@Component({
  selector: 'app-user-settings',
  imports: [FormsModule, Icon, Avatar, StreamOptions],
  template: `
    @if (store.me(); as me) {
      <div class="settings-layer">
        <nav class="settings-nav scroller thin">
          <div class="settings-nav-inner">
            <h3>Configurações de usuário</h3>
            <button [class.active]="section() === 'account'" (click)="section.set('account')">Minha conta</button>
            <button [class.active]="section() === 'profile'" (click)="section.set('profile')">Perfis</button>
            <h3>Configurações do app</h3>
            <button [class.active]="section() === 'appearance'" (click)="section.set('appearance')">Aparência</button>
            <button [class.active]="section() === 'voice'" (click)="openVoice()">Voz e vídeo</button>
            <button [class.active]="section() === 'stream'" (click)="section.set('stream')">Transmissão</button>
            <button [class.active]="section() === 'notifications'" (click)="section.set('notifications')">Notificações</button>
            <div class="settings-sep"></div>
            <button class="danger" (click)="logout()">Sair <app-icon name="logout" [size]="16" /></button>
          </div>
        </nav>
        <div class="settings-content scroller">
          <div class="settings-content-inner">
            @switch (section()) {
              @case ('account') {
                <h2>Minha conta</h2>
                <div class="account-card">
                  <div class="account-banner" [style.background]="me.bannerColor || fallbackBanner()"></div>
                  <div class="account-head">
                    <app-avatar [user]="me" [size]="80" [status]="store.statusOf(me.id)" />
                    <div class="account-name">{{ me.displayName }}</div>
                    <button class="btn btn-brand" (click)="section.set('profile')">Editar perfil de usuário</button>
                  </div>
                  <div class="account-fields">
                    <div class="account-field">
                      <div>
                        <div class="af-label">Nome de exibição</div>
                        <div class="af-value">{{ me.displayName }}</div>
                      </div>
                      <button class="btn btn-secondary" (click)="editDisplayName()">Editar</button>
                    </div>
                    <div class="account-field">
                      <div>
                        <div class="af-label">Nome de usuário</div>
                        <div class="af-value">{{ me.username }}</div>
                      </div>
                      <button class="btn btn-secondary" (click)="editUsername()">Editar</button>
                    </div>
                  </div>
                </div>
                <div class="settings-divider"></div>
                <h3 class="settings-h3">Senha e autenticação</h3>
                <form class="password-form" (ngSubmit)="changePassword()">
                  <label class="field-label">Senha atual</label>
                  <input class="input" type="password" name="cur" [(ngModel)]="pwCurrent" autocomplete="current-password" />
                  <label class="field-label">Nova senha</label>
                  <input class="input" type="password" name="next" [(ngModel)]="pwNext" autocomplete="new-password" />
                  <label class="field-label">Confirmar nova senha</label>
                  <input class="input" type="password" name="confirm" [(ngModel)]="pwConfirm" autocomplete="new-password" />
                  @if (pwError()) {
                    <p class="add-msg error">{{ pwError() }}</p>
                  }
                  <div class="settings-actions">
                    <button class="btn btn-brand" type="submit" [disabled]="!pwCurrent || !pwNext">Mudar senha</button>
                  </div>
                </form>
              }
              @case ('profile') {
                <h2>Perfis</h2>
                <div class="profile-editor">
                  <div class="profile-editor-fields">
                    <label class="field-label">Avatar</label>
                    <div class="row-gap">
                      <button class="btn btn-brand" (click)="changeAvatar()">Mudar avatar</button>
                      @if (me.avatar) {
                        <button class="btn btn-link" (click)="removeAvatar()">Remover avatar</button>
                      }
                    </div>
                    <div class="settings-divider"></div>
                    <label class="field-label">Cor do banner</label>
                    <div class="color-swatches">
                      @for (c of banners; track c) {
                        <button class="swatch big" [style.background]="c" [class.active]="me.bannerColor === c" (click)="setBanner(c)"></button>
                      }
                      <input type="color" class="swatch big picker" [ngModel]="me.bannerColor || '#5865f2'" (ngModelChange)="setBanner($event)" />
                    </div>
                    <div class="settings-divider"></div>
                    <label class="field-label">Sobre mim</label>
                    <textarea class="input textarea" rows="4" maxlength="190" [(ngModel)]="about" placeholder="Conte um pouco sobre você"></textarea>
                    <div class="hint right">{{ 190 - about.length }}</div>
                    <div class="settings-actions">
                      <button class="btn btn-success" (click)="saveAbout()">Salvar alterações</button>
                    </div>
                  </div>
                  <div class="profile-preview">
                    <label class="field-label">Prévia</label>
                    <div class="profile-popout static">
                      <div class="profile-banner" [style.background]="me.bannerColor || fallbackBanner()"></div>
                      <div class="profile-avatar"><app-avatar [user]="me" [size]="80" [status]="store.statusOf(me.id)" /></div>
                      <div class="profile-body">
                        <div class="profile-names">
                          <div class="pn-display">{{ me.displayName }}</div>
                          <div class="pn-user">{{ me.username }}</div>
                        </div>
                        @if (about) {
                          <div class="profile-divider"></div>
                          <div class="profile-section">
                            <h3>Sobre mim</h3>
                            <p class="profile-about">{{ about }}</p>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              }
              @case ('voice') {
                <h2>Configurações de voz</h2>
                <div class="two-col">
                  <div>
                    <label class="field-label">Dispositivo de entrada</label>
                    <select class="input" [ngModel]="prefs.data().inputDevice" (ngModelChange)="voice.changeInputDevice($event)">
                      <option value="default">Padrão</option>
                      @for (d of inputs(); track d.deviceId) {
                        <option [value]="d.deviceId">{{ d.label || 'Microfone' }}</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="field-label">Dispositivo de saída</label>
                    <select class="input" [ngModel]="prefs.data().outputDevice" (ngModelChange)="voice.changeOutputDevice($event)">
                      <option value="default">Padrão</option>
                      @for (d of outputs(); track d.deviceId) {
                        <option [value]="d.deviceId">{{ d.label || 'Alto-falante' }}</option>
                      }
                    </select>
                  </div>
                </div>
                <label class="field-label">Teste de microfone</label>
                <div class="mic-test">
                  <button class="btn btn-brand" (click)="toggleMicTest()">{{ testing() ? 'Parar' : 'Vamos checar' }}</button>
                  <div class="mic-meter">
                    @for (i of meterBars; track i) {
                      <span [class.on]="level() > i * 4"></span>
                    }
                  </div>
                </div>
                <p class="hint">Fale alguma coisa: as barrinhas devem acender. O app já usa cancelamento de eco e supressão de ruído.</p>
                <div class="settings-divider"></div>
                <h2>Configurações de vídeo</h2>
                <label class="field-label">Câmera</label>
                <select class="input" [ngModel]="prefs.data().videoDevice" (ngModelChange)="prefs.set('videoDevice', $event)">
                  <option value="default">Padrão</option>
                  @for (d of cameras(); track d.deviceId) {
                    <option [value]="d.deviceId">{{ d.label || 'Câmera' }}</option>
                  }
                </select>
              }
              @case ('appearance') {
                <h2>Aparência</h2>
                <div class="appearance-preview">
                  <div class="message">
                    <div class="msg-avatar"><app-avatar [user]="me" [size]="40" /></div>
                    <h3 class="msg-header">
                      <span class="msg-author">{{ me.displayName }}</span>
                      <span class="msg-time">Hoje às 12:00</span>
                    </h3>
                    <div class="msg-content">Olha como fica o <strong>Resenha</strong> com esse tema 👀</div>
                  </div>
                  <div class="message grouped">
                    <div class="msg-content">E as menções: <span class="mention">&#64;{{ me.displayName }}</span></div>
                  </div>
                </div>
                <h3 class="settings-h3">Tema</h3>
                <div class="theme-grid">
                  @for (t of baseThemes; track t.id) {
                    <div class="theme-item">
                      <button class="theme-swatch" [class.active]="prefs.data().theme === t.id" [style.background]="t.swatch" [attr.aria-label]="t.label" (click)="prefs.set('theme', t.id)">
                        @if (prefs.data().theme === t.id) {
                          <span class="theme-check"><app-icon name="check" [size]="14" /></span>
                        }
                      </button>
                      <span>{{ t.label }}</span>
                    </div>
                  }
                </div>
                <h3 class="settings-h3">Temas coloridos</h3>
                <div class="theme-grid">
                  @for (t of colorThemes; track t.id) {
                    <div class="theme-item">
                      <button class="theme-swatch" [class.active]="prefs.data().theme === t.id" [style.background]="t.swatch" [attr.aria-label]="t.label" (click)="prefs.set('theme', t.id)">
                        @if (prefs.data().theme === t.id) {
                          <span class="theme-check"><app-icon name="check" [size]="14" /></span>
                        }
                      </button>
                      <span>{{ t.label }}</span>
                    </div>
                  }
                </div>
                <div class="settings-divider"></div>
                <h3 class="settings-h3">Tamanho da fonte do chat</h3>
                <div class="font-slider">
                  <span class="font-a small">A</span>
                  <input type="range" min="12" max="22" step="1" [value]="prefs.data().chatFont" (input)="prefs.set('chatFont', +$any($event.target).value)" />
                  <span class="font-a big">A</span>
                  <span class="font-value">{{ prefs.data().chatFont }}px</span>
                </div>
                <p class="hint">O tema fica salvo neste dispositivo.</p>
              }
              @case ('stream') {
                <h2>Transmissão</h2>
                <p class="hint">
                  Qualidade usada quando você compartilha a tela. O padrão é o máximo: a resolução da sua tela (até 4K), 60 FPS e sem baixar a
                  resolução durante a transmissão.
                </p>
                <app-stream-options [settings]="prefs.data().stream" (settingsChange)="saveStream($event)" />
                @if (voice.localScreen()) {
                  <p class="add-msg success">Você está ao vivo: as mudanças já valem para a transmissão atual.</p>
                }
              }
              @case ('notifications') {
                <h2>Notificações</h2>
                <label class="toggle-row">
                  <div>
                    <div class="toggle-title">Ativar notificações na área de trabalho</div>
                    <div class="hint">Avisa quando alguém te menciona ou manda mensagem direta e o app não está em foco.</div>
                  </div>
                  <input type="checkbox" class="switch" [ngModel]="prefs.data().notifications" (ngModelChange)="setNotifications($event)" />
                </label>
                @if (permission() === 'denied') {
                  <p class="add-msg error">O navegador bloqueou as notificações deste site. Libere nas configurações do navegador.</p>
                }
                <label class="toggle-row">
                  <div>
                    <div class="toggle-title">Sons</div>
                    <div class="hint">Sons de mensagem, entrada e saída de canais de voz e chamadas.</div>
                  </div>
                  <input type="checkbox" class="switch" [ngModel]="prefs.data().sounds" (ngModelChange)="prefs.set('sounds', $event)" />
                </label>
              }
            }
          </div>
          <button class="settings-close" (click)="close()">
            <span class="settings-close-x"><app-icon name="close" [size]="18" /></span>
            <span>ESC</span>
          </button>
        </div>
      </div>
    }
  `,
})
export class UserSettings {
  readonly ui = inject(Ui);
  readonly store = inject(Store);
  readonly prefs = inject(Prefs);
  readonly voice = inject(Voice);
  private api = inject(Api);
  private session = inject(Session);
  readonly banners = BANNERS;
  readonly baseThemes = THEMES.filter((t) => t.group === 'base');
  readonly colorThemes = THEMES.filter((t) => t.group === 'color');
  readonly meterBars = Array.from({ length: 30 }, (_, i) => i);
  readonly section = signal<Section>('account');
  readonly pwError = signal('');
  readonly devices = signal<MediaDeviceInfo[]>([]);
  readonly inputs = computed(() => this.devices().filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default'));
  readonly outputs = computed(() => this.devices().filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default'));
  readonly cameras = computed(() => this.devices().filter((d) => d.kind === 'videoinput'));
  readonly testing = signal(false);
  readonly level = signal(0);
  readonly permission = signal('Notification' in window ? Notification.permission : 'denied');
  readonly fallbackBanner = computed(() => defaultAvatarColor(this.store.me()?.id ?? 0));
  private testStream: MediaStream | null = null;
  private testTimer: ReturnType<typeof setInterval> | null = null;
  about = this.store.me()?.about ?? '';
  pwCurrent = '';
  pwNext = '';
  pwConfirm = '';

  avatar = avatarUrl;

  close() {
    this.stopMicTest();
    this.ui.close();
  }

  ngOnDestroy() {
    this.stopMicTest();
  }

  private patch(body: Record<string, unknown>) {
    return this.api.patch('/users/@me', body);
  }

  editDisplayName() {
    promptDialog(this.ui, { title: 'Alterar seu nome de exibição', label: 'Nome de exibição', initial: this.store.me()!.displayName, maxLength: 32 }, (displayName) =>
      this.patch({ displayName }),
    );
  }

  editUsername() {
    promptDialog(
      this.ui,
      {
        title: 'Alterar seu nome de usuário',
        body: 'Use letras minúsculas, números, "_" e ".".',
        label: 'Nome de usuário',
        initial: this.store.me()!.username,
        maxLength: 32,
      },
      (username) => this.patch({ username }),
    );
  }

  async changePassword() {
    this.pwError.set('');
    if (this.pwNext !== this.pwConfirm) {
      this.pwError.set('As senhas novas não são iguais.');
      return;
    }
    try {
      await this.api.post('/users/@me/password', { current: this.pwCurrent, next: this.pwNext });
      this.pwCurrent = this.pwNext = this.pwConfirm = '';
      this.ui.toast('Senha alterada. Os outros dispositivos foram desconectados.', 'success');
    } catch (e) {
      this.pwError.set(e instanceof Error ? e.message : String(e));
    }
  }

  async changeAvatar() {
    const f = await pickImage();
    if (!f) return;
    try {
      const blob = await squareImage(f, 256);
      const up = await this.api.upload(blob, f.type === 'image/gif' ? 'avatar.gif' : 'avatar.png');
      await this.patch({ avatar: up.key });
    } catch (e) {
      this.ui.error(e);
    }
  }

  removeAvatar() {
    this.patch({ avatar: null }).catch((e) => this.ui.error(e));
  }

  setBanner(c: string) {
    this.patch({ bannerColor: c }).catch((e) => this.ui.error(e));
  }

  saveAbout() {
    this.patch({ about: this.about })
      .then(() => this.ui.toast('Perfil salvo.', 'success'))
      .catch((e) => this.ui.error(e));
  }

  async openVoice() {
    this.section.set('voice');
    try {
      // Labels only show up after the user granted microphone access once.
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      // no permission: list devices without names
    }
    this.devices.set(await navigator.mediaDevices.enumerateDevices());
  }

  async toggleMicTest() {
    if (this.testing()) return this.stopMicTest();
    try {
      const dev = this.prefs.get('inputDevice');
      this.testStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: dev !== 'default' ? { exact: dev } : undefined, echoCancellation: true, noiseSuppression: true },
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(this.testStream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      this.testing.set(true);
      this.testTimer = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const v of data) sum += v;
        this.level.set(Math.min(120, (sum / data.length) * 2.5));
      }, 60);
    } catch {
      this.ui.toast('Não foi possível acessar o microfone.', 'error');
    }
  }

  stopMicTest() {
    this.testStream?.getTracks().forEach((t) => t.stop());
    this.testStream = null;
    if (this.testTimer) clearInterval(this.testTimer);
    this.testTimer = null;
    this.testing.set(false);
    this.level.set(0);
  }

  saveStream(s: StreamSettings) {
    if (this.voice.localScreen()) void this.voice.updateStream(s);
    else this.prefs.set('stream', s);
  }

  async setNotifications(on: boolean) {
    this.prefs.set('notifications', on);
    if (on && 'Notification' in window && Notification.permission === 'default') {
      this.permission.set(await Notification.requestPermission());
    }
  }

  async logout() {
    const ok = await confirmDialog(this.ui, { title: 'Sair', body: 'Tem certeza de que deseja sair?', confirmText: 'Sair', danger: true });
    if (!ok) return;
    this.close();
    await this.session.logout();
  }
}
