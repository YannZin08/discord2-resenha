import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Prefs } from '../../core/prefs';
import { Session } from '../../core/session';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { Voice } from '../../core/voice';
import { avatarUrl, bannerImage, defaultAvatarColor, elapsedLabel } from '../../core/util';
import { detectorScript } from '../../core/game-detector';
import { EmojiManager } from '../emoji-manager';
import { ProfileCard } from '../profile-card';
import { Avatar, Icon } from '../shared';
import { confirmDialog, promptDialog } from './dialogs';
import { StreamOptions } from './go-live';
import { VoiceSettings } from './voice-settings';
import { MAX_PROFILE_IMAGE, bannerImage as cropBanner, pickImage, squareImage } from './image';
import { StreamSettings } from '../../core/prefs';
import { ACCENTS, THEMES } from '../../core/themes';

type Section = 'account' | 'profile' | 'emojis' | 'activity' | 'appearance' | 'voice' | 'stream' | 'notifications';

/** One-click custom statuses for when you aren't playing anything. */
const QUICK_STATUSES = ['Só de boa', 'Estudando', 'Trabalhando', 'Ouvindo música', 'Assistindo um filme', 'Volto já'];

const BANNERS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459f', '#1abc9c', '#9b59b6', '#34495e', '#e67e22', '#2c3e50'];

@Component({
  selector: 'app-user-settings',
  imports: [FormsModule, Icon, Avatar, StreamOptions, VoiceSettings, ProfileCard, EmojiManager],
  template: `
    @if (store.me(); as me) {
      <div class="settings-layer">
        <nav class="settings-nav scroller thin">
          <div class="settings-nav-inner">
            <h3>Configurações de usuário</h3>
            <button [class.active]="section() === 'account'" (click)="section.set('account')">Minha conta</button>
            <button [class.active]="section() === 'profile'" (click)="section.set('profile')">Perfis</button>
            <button [class.active]="section() === 'emojis'" (click)="section.set('emojis')">Meus emojis</button>
            <button [class.active]="section() === 'activity'" (click)="section.set('activity')">Atividade</button>
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
                  <div class="account-banner" [style.background-color]="me.bannerColor || fallbackBanner()" [style.background-image]="banner(me)"></div>
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
                    <p class="hint">PNG, JPG ou GIF animado, até 10 MB.</p>
                    <div class="row-gap">
                      <button class="btn btn-brand" [disabled]="!!uploading()" (click)="changeAvatar()">
                        {{ uploading() === 'avatar' ? 'Enviando...' : 'Mudar avatar' }}
                      </button>
                      @if (me.avatar) {
                        <button class="btn btn-link" (click)="removeAvatar()">Remover avatar</button>
                      }
                    </div>
                    <div class="settings-divider"></div>
                    <label class="field-label">Banner do perfil</label>
                    <p class="hint">Imagem ou GIF animado, até 10 MB. Tamanho ideal: 680 × 240.</p>
                    <div class="row-gap">
                      <button class="btn btn-brand" [disabled]="!!uploading()" (click)="changeBanner()">
                        {{ uploading() === 'banner' ? 'Enviando...' : 'Mudar banner' }}
                      </button>
                      @if (me.banner) {
                        <button class="btn btn-link" (click)="removeBanner()">Remover banner</button>
                      }
                    </div>
                    <div class="settings-divider"></div>
                    <label class="field-label">Cor do banner</label>
                    <p class="hint">{{ me.banner ? 'Aparece se você remover a imagem do banner.' : 'Aparece quando o banner não tem imagem.' }}</p>
                    <div class="color-swatches">
                      @for (c of banners; track c) {
                        <button class="swatch big" [style.background]="c" [class.active]="me.bannerColor === c" (click)="setBanner(c)"></button>
                      }
                      <input type="color" class="swatch big picker" [ngModel]="me.bannerColor || '#5865f2'" (ngModelChange)="setBanner($event)" />
                    </div>
                    <div class="settings-divider"></div>
                    <label class="field-label">Tema do perfil</label>
                    <p class="hint">Duas cores que pintam o seu card inteiro em degradê, de cima para baixo.</p>
                    <div class="theme-pickers">
                      <label class="theme-picker">
                        <input type="color" class="swatch big picker" [value]="themeDraft()?.[0] ?? '#5865f2'" (input)="pickTheme(0, $event)" (change)="saveTheme()" />
                        <span>Principal</span>
                      </label>
                      <label class="theme-picker">
                        <input type="color" class="swatch big picker" [value]="themeDraft()?.[1] ?? '#eb459f'" (input)="pickTheme(1, $event)" (change)="saveTheme()" />
                        <span>Destaque</span>
                      </label>
                      @if (themeDraft()) {
                        <button class="btn btn-link" (click)="removeTheme()">Remover tema</button>
                      }
                    </div>
                    <div class="settings-divider"></div>
                    <label class="field-label">Pronomes</label>
                    <input class="input" maxlength="40" [ngModel]="pronouns()" (ngModelChange)="pronouns.set($event)" placeholder="Ex.: ele/dele, ela/dela" />
                    <div class="settings-divider"></div>
                    <label class="field-label">Sobre mim</label>
                    <textarea
                      class="input textarea"
                      rows="4"
                      maxlength="190"
                      [ngModel]="about()"
                      (ngModelChange)="about.set($event)"
                      placeholder="Conte um pouco sobre você"
                    ></textarea>
                    <div class="hint right">{{ 190 - about().length }}</div>
                    <div class="settings-actions">
                      <button class="btn btn-success" (click)="saveAbout()">Salvar alterações</button>
                    </div>
                  </div>
                  <div class="profile-preview">
                    <label class="field-label">Prévia</label>
                    <app-profile-card class="profile-preview-card" [user]="previewUser()!" [preview]="true" />
                  </div>
                </div>
              }
              @case ('voice') {
                <app-voice-settings />
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
                <h3 class="settings-h3">Cor de destaque</h3>
                <p class="hint">Pinta botões, menções e seleções por cima de qualquer tema.</p>
                <div class="color-swatches accent-swatches">
                  <button class="swatch big accent-default" [class.active]="!prefs.data().accent" title="Cor do tema" aria-label="Cor do tema" (click)="prefs.set('accent', null)">
                    @if (!prefs.data().accent) {
                      <app-icon name="check" [size]="16" />
                    }
                  </button>
                  @for (c of accents; track c) {
                    <button class="swatch big" [style.background]="c" [class.active]="prefs.data().accent === c" (click)="prefs.set('accent', c)">
                      @if (prefs.data().accent === c) {
                        <app-icon name="check" [size]="16" />
                      }
                    </button>
                  }
                  <input type="color" class="swatch big picker" [value]="prefs.data().accent || '#5865f2'" (input)="prefs.set('accent', $any($event.target).value)" />
                </div>
                <div class="settings-divider"></div>
                <h3 class="settings-h3">Tamanho da fonte do chat</h3>
                <div class="font-slider">
                  <span class="font-a small">A</span>
                  <input type="range" min="12" max="22" step="1" [value]="prefs.data().chatFont" (input)="prefs.set('chatFont', +$any($event.target).value)" />
                  <span class="font-a big">A</span>
                  <span class="font-value">{{ prefs.data().chatFont }}px</span>
                </div>
                <div class="settings-divider"></div>
                <label class="toggle-row">
                  <div>
                    <div class="toggle-title">Reduzir movimento</div>
                    <div class="hint">Desliga as animações ao clicar, selecionar e abrir menus e janelas.</div>
                  </div>
                  <input type="checkbox" class="switch" [ngModel]="prefs.data().reduceMotion" (ngModelChange)="prefs.set('reduceMotion', $event)" />
                </label>
                <p class="hint">O tema e essas opções ficam salvos neste dispositivo.</p>
              }
              @case ('emojis') {
                <h2>Meus emojis</h2>
                <p class="hint">
                  Emojis só seus, que não dependem de servidor: você usa em qualquer servidor e nas mensagens diretas, e todo mundo vê nas suas
                  mensagens e reações. Sem limite e sem Nitro, inclusive GIFs animados. Para usar, digite <code>:nome:</code> ou abra o seletor de
                  emojis, na seção "Seus emojis".
                </p>
                <app-emoji-manager path="/users/@me/emojis" [emojis]="store.myEmojis()" empty="Você ainda não tem emojis seus. Envie o primeiro!" />
              }
              @case ('activity') {
                <h2>Atividade</h2>
                <p class="hint">Mostra para os seus amigos e servidores o que você está jogando, como "Jogando Crimson Desert".</p>
                @if (store.activityOf(me.id); as a) {
                  <div class="activity-now">
                    <span class="activity-icon"><app-icon name="game" [size]="28" /></span>
                    <div class="activity-text">
                      <div class="activity-head">Jogando agora</div>
                      <div class="activity-name">{{ a.name }}</div>
                      <div class="hint">{{ elapsed(a.since, store.now()) }}{{ a.until ? ' · detectado automaticamente' : '' }}</div>
                    </div>
                    <button class="btn btn-secondary" (click)="setActivity(null)">Parar</button>
                  </div>
                } @else {
                  <div class="activity-now idle">
                    <span class="activity-icon"><app-icon name="game" [size]="28" /></span>
                    <div class="activity-text">
                      <div class="activity-head">Nenhum jogo agora</div>
                      <div class="hint">{{ me.customStatus || 'Defina um jogo abaixo ou ligue a detecção automática.' }}</div>
                    </div>
                  </div>
                }
                <div class="settings-divider"></div>
                <label class="field-label">Definir jogo manualmente</label>
                <div class="row-gap">
                  <input class="input" maxlength="64" placeholder="Ex.: Crimson Desert" [(ngModel)]="gameDraft" (keydown.enter)="setActivity(gameDraft)" />
                  <button class="btn btn-brand" [disabled]="!gameDraft.trim()" (click)="setActivity(gameDraft)">Definir</button>
                </div>
                <p class="hint">Fica até você parar ou a detecção automática achar outro jogo.</p>
                <div class="settings-divider"></div>
                <label class="field-label">Quando não estiver jogando</label>
                <p class="hint">Vira o seu status personalizado, como "Matteo está só de boa".</p>
                <div class="chip-row">
                  @for (q of quickStatuses; track q) {
                    <button class="chip" [class.active]="me.customStatus === q" (click)="setQuickStatus(me.customStatus === q ? '' : q)">{{ q }}</button>
                  }
                </div>
                <div class="settings-divider"></div>
                <h3 class="settings-h3">Detecção automática de jogos (Windows)</h3>
                <p class="hint">
                  Um navegador não consegue ver os programas abertos no PC, então o Resenha usa um detector pequeno. Baixe, dê dois cliques e deixe a
                  janela aberta (pode minimizar). Ele reconhece qualquer jogo da Steam e vários outros (VALORANT, LoL, Fortnite, Minecraft, Roblox...).
                </p>
                <div class="row-gap">
                  <button class="btn btn-brand" [disabled]="downloading()" (click)="downloadDetector()">
                    {{ downloading() ? 'Gerando...' : 'Baixar detector de jogos' }}
                  </button>
                </div>
                <p class="hint">
                  O arquivo traz uma chave só sua, que só serve para avisar o jogo. Baixar de novo cria uma chave nova e a do arquivo antigo para de
                  funcionar. Se o Windows avisar que o arquivo é desconhecido, clique em "Mais informações" e "Executar assim mesmo".
                </p>
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
  readonly accents = ACCENTS;
  readonly quickStatuses = QUICK_STATUSES;
  readonly elapsed = elapsedLabel;
  gameDraft = '';
  readonly downloading = signal(false);
  /** Section to open on, e.g. "profile" from the profile card's "Editar perfil". */
  readonly start = input<Section>('account');
  readonly section = linkedSignal(() => this.start());
  readonly pwError = signal('');
  readonly uploading = signal<'avatar' | 'banner' | null>(null);
  readonly permission = signal('Notification' in window ? Notification.permission : 'denied');
  readonly fallbackBanner = computed(() => defaultAvatarColor(this.store.me()?.id ?? 0));
  readonly about = signal(this.store.me()?.about ?? '');
  readonly pronouns = signal(this.store.me()?.pronouns ?? '');
  /** Profile theme being picked: shown live in the preview, saved when the picker closes. */
  readonly themeDraft = linkedSignal(() => this.store.me()?.themeColors ?? null);
  /** The preview shows what's typed before it's saved. */
  readonly previewUser = computed(() => {
    const me = this.store.me();
    return me ? { ...me, about: this.about(), pronouns: this.pronouns(), themeColors: this.themeDraft() } : null;
  });
  pwCurrent = '';
  pwNext = '';
  pwConfirm = '';

  avatar = avatarUrl;
  banner = bannerImage;

  close() {
    this.ui.close();
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

  changeAvatar() {
    return this.uploadProfileImage('avatar', (f) => squareImage(f, 256));
  }

  removeAvatar() {
    this.patch({ avatar: null }).catch((e) => this.ui.error(e));
  }

  changeBanner() {
    return this.uploadProfileImage('banner', cropBanner);
  }

  removeBanner() {
    this.patch({ banner: null }).catch((e) => this.ui.error(e));
  }

  /** Avatar or banner: GIFs go up as they are, so they stay animated. */
  private async uploadProfileImage(field: 'avatar' | 'banner', prepare: (f: File) => Promise<Blob>) {
    const f = await pickImage();
    if (!f) return;
    const what = field === 'avatar' ? 'O avatar' : 'O banner';
    if (f.type === 'image/gif' && f.size > MAX_PROFILE_IMAGE) {
      this.ui.toast(`${what} pode ter até 10 MB e esse GIF tem ${(f.size / 1024 / 1024).toFixed(1)} MB. Escolha um GIF menor.`, 'error');
      return;
    }
    this.uploading.set(field);
    try {
      const blob = await prepare(f);
      const ext = blob.type === 'image/gif' ? 'gif' : blob.type === 'image/webp' ? 'webp' : 'png';
      const up = await this.api.upload(blob, `${field}.${ext}`);
      await this.patch({ [field]: up.key });
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.uploading.set(null);
    }
  }

  setBanner(c: string) {
    this.patch({ bannerColor: c }).catch((e) => this.ui.error(e));
  }

  saveAbout() {
    this.patch({ about: this.about(), pronouns: this.pronouns().trim() })
      .then(() => this.ui.toast('Perfil salvo.', 'success'))
      .catch((e) => this.ui.error(e));
  }

  setActivity(name: string | null) {
    const game = name?.trim() || null;
    this.api.put('/users/@me/activity', { name: game }).then(
      () => (this.gameDraft = ''),
      (e) => this.ui.error(e),
    );
  }

  setQuickStatus(customStatus: string) {
    this.patch({ customStatus }).catch((e) => this.ui.error(e));
  }

  /** Makes a fresh detector key and saves the .cmd with it inside. */
  async downloadDetector() {
    this.downloading.set(true);
    try {
      const { token } = await this.api.post<{ token: string }>('/users/@me/activity-token', {});
      const script = detectorScript(`${location.origin}/api/users/@me/activity`, token);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([script], { type: 'application/octet-stream' }));
      a.download = 'resenha-detector-de-jogos.cmd';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.downloading.set(false);
    }
  }

  pickTheme(i: 0 | 1, e: Event) {
    const next = [...(this.themeDraft() ?? ['#5865f2', '#eb459f'])] as [string, string];
    next[i] = (e.target as HTMLInputElement).value;
    this.themeDraft.set(next);
  }

  saveTheme() {
    const t = this.themeDraft();
    if (t) this.patch({ themeColors: t }).catch((e) => this.ui.error(e));
  }

  removeTheme() {
    this.themeDraft.set(null);
    this.patch({ themeColors: null }).catch((e) => this.ui.error(e));
  }

  openVoice() {
    this.section.set('voice');
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
