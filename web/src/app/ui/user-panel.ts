import { Component, computed, inject } from '@angular/core';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Session } from '../core/session';
import { Store } from '../core/store';
import type { Status, StatusPref } from '../core/types';
import { MenuItem, Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { channelLabel, copyText } from '../core/util';
import { ConnectionInfo } from './modals/connection-info';
import { promptDialog } from './modals/dialogs';
import { toggleStream } from './modals/go-live';
import { UserSettings } from './modals/user-settings';
import { Avatar, Icon, STATUS_LABELS } from './shared';
import { Tip } from './tooltip';

@Component({
  selector: 'app-user-panel',
  imports: [Avatar, Icon, Tip],
  template: `
    @if (voice.channelId()) {
      <div class="voice-panel">
        <div class="vp-top">
          <div class="vp-info">
            <div
              class="vp-status"
              [class.ok]="voice.connectionLabel() === 'Voz conectada'"
              [class.bad]="voice.connectionLabel() === 'Falha na conexão'"
              appTip="Detalhes da conexão"
              (click)="ui.open(connectionInfo)"
            >
              <app-icon name="signal" [size]="16" /> {{ voice.connectionLabel() }}
            </div>
            <div class="vp-where" (click)="goToVoice()">{{ voiceWhere() }}</div>
          </div>
          <button class="icon-btn" appTip="Desconectar" (click)="voice.leave()"><app-icon name="hangup" [size]="20" /></button>
        </div>
        <div class="vp-actions">
          <button class="vp-btn" [class.on]="!!voice.localCamera()" (click)="voice.toggleCamera()" [appTip]="voice.localCamera() ? 'Desligar câmera' : 'Ligar câmera'">
            <app-icon [name]="voice.localCamera() ? 'video' : 'videoOff'" [size]="20" />
          </button>
          <button class="vp-btn" [class.on]="!!voice.localScreen()" (click)="stream()" [appTip]="voice.localScreen() ? 'Parar transmissão' : 'Transmitir tela'">
            <app-icon name="screen" [size]="20" />
          </button>
        </div>
      </div>
    }
    @if (store.me(); as me) {
      <div class="user-panel">
        <div class="up-user" (click)="statusMenu($event)">
          <app-avatar [user]="me" [size]="32" [status]="myStatus()" [speaking]="voice.speaking().has(me.id)" />
          <div class="up-names">
            <div class="up-display">{{ me.displayName }}</div>
            <div class="up-sub">
              <span class="up-sub-a">{{ me.customStatus || statusLabel() }}</span>
              <span class="up-sub-b">{{ me.username }}</span>
            </div>
          </div>
        </div>
        <button class="icon-btn" [class.danger]="voice.mute() || voice.deaf()" [appTip]="voice.mute() || voice.deaf() ? 'Ativar microfone' : 'Silenciar'" (click)="voice.toggleMute()">
          <app-icon [name]="voice.mute() || voice.deaf() ? 'micOff' : 'mic'" [size]="20" />
        </button>
        <button class="icon-btn" [class.danger]="voice.deaf()" [appTip]="voice.deaf() ? 'Ativar áudio' : 'Ensurdecer'" (click)="voice.toggleDeaf()">
          <app-icon [name]="voice.deaf() ? 'headsetOff' : 'headset'" [size]="20" />
        </button>
        <button class="icon-btn" appTip="Configurações de usuário" (click)="ui.open(settings)"><app-icon name="gear" [size]="20" /></button>
      </div>
    }
  `,
})
export class UserPanel {
  readonly store = inject(Store);
  readonly voice = inject(Voice);
  readonly ui = inject(Ui);
  private api = inject(Api);
  private nav = inject(Nav);
  private session = inject(Session);
  readonly settings = UserSettings;
  readonly connectionInfo = ConnectionInfo;

  readonly myStatus = computed<Status>(() => {
    const me = this.store.me();
    return me ? this.store.presences()[me.id] ?? (me.status as Status) ?? 'online' : 'offline';
  });
  readonly statusLabel = computed(() => STATUS_LABELS[this.myStatus()]);
  readonly voiceWhere = computed(() => {
    const c = this.store.channels()[this.voice.channelId() ?? 0];
    if (!c) return '';
    if (c.guildId == null) return channelLabel(c, this.store.users(), this.store.me()?.id);
    return `${c.name} / ${this.store.guilds()[c.guildId]?.name ?? ''}`;
  });

  stream() {
    toggleStream(this.ui, this.voice);
  }

  goToVoice() {
    const c = this.store.channels()[this.voice.channelId() ?? 0];
    if (c) this.nav.openChannel(c.guildId, c.id);
  }

  setStatus(status: StatusPref) {
    this.api.patch('/users/@me', { status }).catch((e) => this.ui.error(e));
  }

  statusMenu(e: MouseEvent) {
    const me = this.store.me()!;
    const pref = me.status ?? 'online';
    const s = (status: StatusPref, hint?: string): MenuItem => ({
      label: STATUS_LABELS[status],
      hint,
      color: { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', invisible: '#80848e' }[status],
      icon: pref === status ? 'check' : undefined,
      action: () => this.setStatus(status),
    });
    this.ui.openMenuAt(
      e.currentTarget as Element,
      [
        s('online'),
        s('idle'),
        s('dnd', 'Você não vai receber notificações'),
        s('invisible', 'Você aparece offline'),
        { separator: true },
        {
          label: me.customStatus ? 'Editar status personalizado' : 'Definir status personalizado',
          icon: 'smile',
          action: () =>
            promptDialog(
              this.ui,
              { title: 'Definir um status personalizado', label: 'O que está rolando?', initial: me.customStatus, maxLength: 128, placeholder: 'Jogando, estudando, de boa...' },
              (customStatus) => this.api.patch('/users/@me', { customStatus }),
            ),
        },
        { label: 'Copiar nome de usuário', icon: 'copy', action: () => void copyText(me.username) },
        { separator: true },
        { label: 'Sair', icon: 'logout', danger: true, action: () => void this.session.logout() },
      ],
      'below',
    );
    // open the menu above the panel
    const m = this.ui.menu();
    if (m) this.ui.menu.set({ ...m, y: (e.currentTarget as Element).getBoundingClientRect().top - 330 });
  }
}
