import { Component, OnDestroy, inject, signal } from '@angular/core';
import { Store } from '../../core/store';
import { Ui } from '../../core/ui';
import { PeerInfo, Voice } from '../../core/voice';
import { Avatar, Icon } from '../shared';

const ROUTES: Record<string, string> = {
  lan: 'Direta (mesma rede)',
  direct: 'Direta pela internet',
  relay: 'Retransmitida (TURN)',
};

const STATES: Record<string, string> = {
  new: 'Iniciando',
  connecting: 'Conectando',
  connected: 'Conectado',
  disconnected: 'Caiu, tentando de novo',
  failed: 'Falhou',
  closed: 'Encerrado',
};

/** Shows how the call reaches each person, so network problems are visible. */
@Component({
  selector: 'app-connection-info',
  imports: [Avatar, Icon],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <div class="modal" role="dialog">
      <button class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
      <div class="modal-body">
        <h2 class="left">Detalhes da conexão</h2>
        <p class="modal-sub">Servidor de retransmissão (TURN): {{ voice.relay() ? 'configurado' : 'não configurado' }}</p>
        @for (p of peers(); track p.userId) {
          <div class="conn-row">
            <app-avatar [user]="store.users()[p.userId]" [size]="32" />
            <div class="conn-text">
              <div class="conn-name">{{ store.nameIn(voice.guildId(), p.userId) }}</div>
              <div class="conn-sub" [class.ok]="p.state === 'connected'" [class.bad]="p.state === 'failed' || p.state === 'disconnected'">
                {{ stateLabel(p.state) }}{{ p.route ? ' · ' + routeLabel(p.route) : '' }}{{ p.rtt != null ? ' · ' + p.rtt + ' ms' : '' }}
              </div>
              <div class="conn-sub">Recebido {{ size(p.received) }} · enviado {{ size(p.sent) }}</div>
            </div>
          </div>
        } @empty {
          <p class="hint">Ninguém mais está na chamada.</p>
        }
        @if (problem()) {
          <p class="add-msg error">
            A conexão direta entre vocês não está passando. Isso acontece com CGNAT de provedor, firewall de empresa ou Wi-Fi com isolamento.
            {{ voice.relay() ? 'O retransmissor está configurado; confira a internet de quem está com falha.' : 'Para resolver, o servidor precisa de um retransmissor TURN.' }}
          </p>
        }
      </div>
    </div>
  `,
})
export class ConnectionInfo implements OnDestroy {
  readonly ui = inject(Ui);
  readonly store = inject(Store);
  readonly voice = inject(Voice);
  readonly peers = signal<PeerInfo[]>([]);
  readonly problem = signal(false);
  private timer = setInterval(() => void this.refresh(), 1500);

  constructor() {
    void this.refresh();
  }

  ngOnDestroy() {
    clearInterval(this.timer);
  }

  private async refresh() {
    const list = await this.voice.diagnostics();
    this.peers.set(list);
    this.problem.set(list.some((p) => p.state !== 'connected'));
  }

  stateLabel(s: string) {
    return STATES[s] ?? s;
  }

  routeLabel(r: string) {
    return ROUTES[r] ?? r;
  }

  size(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  }
}
