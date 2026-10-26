import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Nav } from '../../core/nav';
import { Store } from '../../core/store';
import type { BotInfo, Role, User } from '../../core/types';
import { Ui } from '../../core/ui';
import { Voice } from '../../core/voice';
import { fileUrl, formatLongDate } from '../../core/util';
import { userMenuItems } from '../menus';
import { Avatar, GuildIcon, Icon } from '../shared';
import { confirmDialog, promptDialog } from './dialogs';
import { pickImage, squareImage } from './image';

type Section = 'overview' | 'roles' | 'bots' | 'members' | 'invites' | 'bans';

const ROLE_COLORS = ['#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b', '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457', '#c27c0e', '#a84300', '#992d22'];

@Component({
  selector: 'app-guild-settings',
  imports: [FormsModule, Icon, GuildIcon, Avatar],
  template: `
    @if (guild(); as g) {
      <div class="settings-layer">
        <nav class="settings-nav scroller thin">
          <div class="settings-nav-inner">
            <h3>{{ g.name }}</h3>
            <button [class.active]="section() === 'overview'" (click)="section.set('overview')">Visão geral</button>
            <button [class.active]="section() === 'roles'" (click)="section.set('roles')">Cargos</button>
            <button [class.active]="section() === 'bots'" (click)="openBots()">Bots</button>
            <h3>Gestão de membros</h3>
            <button [class.active]="section() === 'members'" (click)="section.set('members')">Membros</button>
            <button [class.active]="section() === 'invites'" (click)="openInvites()">Convites</button>
            <button [class.active]="section() === 'bans'" (click)="openBans()">Banimentos</button>
            @if (owner()) {
              <div class="settings-sep"></div>
              <button class="danger" (click)="deleteGuild()">Excluir servidor <app-icon name="trash" [size]="16" /></button>
            }
          </div>
        </nav>
        <div class="settings-content scroller">
          <div class="settings-content-inner">
            @switch (section()) {
              @case ('overview') {
                <h2>Visão geral do servidor</h2>
                <div class="overview">
                  <div class="overview-icon">
                    <div class="overview-icon-img" (click)="chooseIcon()">
                      @if (iconPreview(); as src) {
                        <img [src]="src" alt="" />
                      } @else {
                        <app-guild-icon [name]="name" [icon]="null" [size]="100" />
                      }
                      <span class="overview-icon-hover">MUDAR ÍCONE</span>
                    </div>
                    @if (iconPreview()) {
                      <button class="btn-link-inline" (click)="removeIcon()">Remover</button>
                    }
                  </div>
                  <div class="overview-fields">
                    <p class="hint">Recomendamos uma imagem de pelo menos 512x512 para o servidor.</p>
                    <button class="btn btn-outline" (click)="chooseIcon()">Enviar imagem</button>
                  </div>
                </div>
                <label class="field-label">Nome do servidor</label>
                <input class="input" [(ngModel)]="name" maxlength="100" />
                <label class="field-label">Canal de mensagens do sistema</label>
                <select class="input" [(ngModel)]="systemChannelId">
                  <option [ngValue]="null">Sem mensagens do sistema</option>
                  @for (c of textChannels(); track c.id) {
                    <option [ngValue]="c.id">#{{ c.name }}</option>
                  }
                </select>
                <p class="hint">É aqui que avisamos quando alguém entra no servidor.</p>
                <div class="settings-actions">
                  <button class="btn btn-success" [disabled]="busy()" (click)="saveOverview()">Salvar alterações</button>
                </div>
              }
              @case ('roles') {
                <h2>Cargos</h2>
                <p class="hint">Use cargos para organizar os membros, dar cores aos nomes e definir quem administra o servidor.</p>
                <div class="roles-layout">
                  <div class="roles-list">
                    <button class="btn btn-brand btn-block" (click)="createRole()">Criar cargo</button>
                    @for (r of roles(); track r.id) {
                      <div class="role-row" [class.active]="editingRole()?.id === r.id" (click)="selectRole(r)">
                        <i class="role-dot" [style.background]="r.color || '#99aab5'"></i>
                        <span>{{ r.name }}</span>
                        <span class="role-count">{{ roleCount(r.id) }} <app-icon name="members" [size]="14" /></span>
                      </div>
                    } @empty {
                      <p class="hint">Nenhum cargo ainda.</p>
                    }
                  </div>
                  @if (editingRole(); as r) {
                    <div class="role-editor">
                      <label class="field-label">Nome do cargo</label>
                      <input class="input" [(ngModel)]="roleDraft.name" maxlength="100" />
                      <label class="field-label">Cor do cargo</label>
                      <div class="color-swatches">
                        <button class="swatch default" [class.active]="!roleDraft.color" (click)="roleDraft.color = null" title="Padrão"></button>
                        <input type="color" class="swatch picker" [ngModel]="roleDraft.color || '#99aab5'" (ngModelChange)="roleDraft.color = $event" />
                        @for (c of colors; track c) {
                          <button class="swatch" [style.background]="c" [class.active]="roleDraft.color === c" (click)="roleDraft.color = c"></button>
                        }
                      </div>
                      <label class="toggle-row">
                        <div>
                          <div class="toggle-title">Exibir separadamente</div>
                          <div class="hint">Mostra membros com este cargo em um grupo próprio na lista de membros.</div>
                        </div>
                        <input type="checkbox" class="switch" [(ngModel)]="roleDraft.hoist" />
                      </label>
                      <label class="toggle-row">
                        <div>
                          <div class="toggle-title">Administrador</div>
                          <div class="hint">Pode gerenciar canais, cargos, membros, convites e apagar ou fixar mensagens.</div>
                        </div>
                        <input type="checkbox" class="switch" [(ngModel)]="roleDraft.admin" />
                      </label>
                      <div class="settings-actions">
                        <button class="btn btn-secondary" (click)="moveRole(r, 1)" title="Subir">▲</button>
                        <button class="btn btn-secondary" (click)="moveRole(r, -1)" title="Descer">▼</button>
                        <span class="spacer"></span>
                        <button class="btn btn-danger-outline" (click)="deleteRole(r)">Excluir cargo</button>
                        <button class="btn btn-success" (click)="saveRole(r)">Salvar</button>
                      </div>
                    </div>
                  }
                </div>
              }
              @case ('bots') {
                <h2>Bots</h2>
                <p class="hint">Bots são membros automáticos do servidor. Use o bot de música pronto ou crie os seus.</p>
                <div class="bot-card">
                  <div class="bot-card-icon">🎵</div>
                  <div class="bot-card-text">
                    <div class="bot-card-title">Música <span class="bot-tag">BOT</span></div>
                    <p>
                      Toca músicas do YouTube no canal de voz, sincronizadas para todo mundo da call. Entre num canal de voz e digite
                      <code>/tocar</code> com o link ou o nome da música. Também tem <code>/pular</code>, <code>/pausar</code>,
                      <code>/continuar</code>, <code>/fila</code> e <code>/parar</code>.
                    </p>
                  </div>
                  @if (musicBot()) {
                    <button class="btn btn-danger-outline" (click)="removeBot(musicBot()!)">Remover</button>
                  } @else {
                    <button class="btn btn-brand" (click)="addMusicBot()">Adicionar ao servidor</button>
                  }
                </div>

                <div class="settings-divider"></div>
                <h3 class="settings-h3">Bots personalizados</h3>
                <p class="hint">
                  Crie um bot e use o token dele no seu próprio programa (Node, Python...) para ler e mandar mensagens, como no portal de
                  desenvolvedores do Discord. Há um exemplo pronto em <code>examples/bot-exemplo.mjs</code> no projeto.
                </p>
                <div class="settings-actions">
                  <button class="btn btn-brand" (click)="createBot()">Criar bot</button>
                </div>
                @if (newToken(); as t) {
                  <div class="token-box">
                    <div class="toggle-title">Token de {{ t.name }}</div>
                    <p class="hint">Copie agora: ele não aparece de novo. Quem tiver o token controla o bot, então não compartilhe.</p>
                    <div class="copy-box">
                      <input readonly [value]="t.token" (focus)="$any($event.target).select()" />
                      <button class="btn btn-brand" (click)="copyToken(t.token)">Copiar</button>
                    </div>
                    <p class="hint">
                      Conecte com o cabeçalho <code>Authorization: Bot &lt;token&gt;</code> em <code>{{ origin }}/api</code> (REST) e
                      <code>{{ wsOrigin }}/api/gateway</code> (eventos em tempo real).
                    </p>
                  </div>
                }
                @for (b of customBots(); track b.user.id) {
                  <div class="bot-row">
                    <app-avatar [user]="b.user" [size]="32" />
                    <div class="bot-row-text">
                      <div class="mt-display">{{ b.user.displayName }} <span class="bot-tag">BOT</span></div>
                      <div class="mt-user">{{ b.user.username }}</div>
                    </div>
                    <button class="btn btn-secondary small" (click)="regenerate(b)">Gerar novo token</button>
                    <button class="btn btn-danger-outline small" (click)="removeBot(b)">Remover</button>
                  </div>
                } @empty {
                  <p class="hint">Nenhum bot personalizado ainda.</p>
                }
              }
              @case ('members') {
                <h2>Membros do servidor</h2>
                <input class="input" placeholder="Buscar membros" [ngModel]="memberFilter()" (ngModelChange)="memberFilter.set($event)" />
                <div class="member-table">
                  @for (u of members(); track u.id) {
                    <div class="member-table-row" (contextmenu)="memberMenu($event, u)">
                      <app-avatar [user]="u" [size]="40" />
                      <div class="mt-names">
                        <div class="mt-display">{{ store.nameIn(g.id, u.id) }}</div>
                        <div class="mt-user">{{ u.username }}</div>
                      </div>
                      <div class="mt-joined">Entrou {{ joined(u.id) }}</div>
                      <div class="role-pills">
                        @for (r of memberRoles(u.id); track r.id) {
                          <span class="role-pill"><i class="role-dot" [style.background]="r.color || '#99aab5'"></i>{{ r.name }}</span>
                        }
                      </div>
                      <button class="icon-btn" (click)="memberMenu($event, u)"><app-icon name="moreVert" [size]="20" /></button>
                    </div>
                  }
                </div>
              }
              @case ('invites') {
                <h2>Convites</h2>
                <div class="table">
                  <div class="table-head"><span>Convidado por</span><span>Código</span><span>Usos</span><span></span></div>
                  @for (i of invites(); track i.code) {
                    <div class="table-row">
                      <span class="table-user"><app-avatar [user]="i.inviter" [size]="24" /> {{ i.inviter?.displayName }}</span>
                      <span class="mono">{{ i.code }}</span>
                      <span>{{ i.uses }}</span>
                      <button class="icon-btn" title="Revogar convite" (click)="revoke(i.code)"><app-icon name="close" [size]="18" /></button>
                    </div>
                  } @empty {
                    <p class="hint">Nenhum convite criado ainda.</p>
                  }
                </div>
              }
              @case ('bans') {
                <h2>Banimentos</h2>
                <div class="table">
                  @for (b of bans(); track b.user.id) {
                    <div class="table-row">
                      <span class="table-user"><app-avatar [user]="b.user" [size]="24" /> {{ b.user.displayName }} <span class="muted">{{ b.user.username }}</span></span>
                      <span></span>
                      <span></span>
                      <button class="btn btn-danger-outline small" (click)="unban(b.user.id)">Revogar banimento</button>
                    </div>
                  } @empty {
                    <p class="hint">Ninguém foi banido. Que paz!</p>
                  }
                </div>
              }
            }
          </div>
          <button class="settings-close" (click)="ui.close()">
            <span class="settings-close-x"><app-icon name="close" [size]="18" /></span>
            <span>ESC</span>
          </button>
        </div>
      </div>
    }
  `,
})
export class GuildSettings {
  readonly guildId = input.required<number>();
  readonly ui = inject(Ui);
  readonly store = inject(Store);
  private api = inject(Api);
  private nav = inject(Nav);
  private voice = inject(Voice);
  readonly colors = ROLE_COLORS;
  readonly section = signal<Section>('overview');
  readonly busy = signal(false);
  readonly guild = computed(() => this.store.guilds()[this.guildId()]);
  readonly owner = computed(() => this.store.isOwner(this.guildId()));
  readonly roles = computed(() => this.store.roles()[this.guildId()] ?? []);
  readonly textChannels = computed(() => this.store.guildChannels(this.guildId()).filter((c) => c.type === 'text'));
  readonly iconPreview = signal<string | null>(null);
  readonly invites = signal<{ code: string; uses: number; inviter: User | null }[]>([]);
  readonly bans = signal<{ user: User }[]>([]);
  readonly memberFilter = signal('');
  readonly editingRole = signal<Role | null>(null);
  roleDraft: { name: string; color: string | null; hoist: boolean; admin: boolean } = { name: '', color: null, hoist: false, admin: false };
  private iconKey: string | null | undefined = undefined;
  name = '';
  systemChannelId: number | null = null;

  readonly members = computed(() => {
    const q = this.memberFilter().toLowerCase();
    const gid = this.guildId();
    return Object.keys(this.store.members()[gid] ?? {})
      .map((id) => this.store.users()[+id])
      .filter((u) => u && (!q || u.username.includes(q) || this.store.nameIn(gid, u.id).toLowerCase().includes(q)))
      .sort((a, b) => this.store.nameIn(gid, a.id).localeCompare(this.store.nameIn(gid, b.id), 'pt-BR'));
  });

  ngOnInit() {
    const g = this.guild();
    if (!g) return;
    this.name = g.name;
    this.systemChannelId = g.systemChannelId;
    this.iconPreview.set(g.icon ? fileUrl(g.icon, 'icon') : null);
  }

  async chooseIcon() {
    const f = await pickImage();
    if (!f) return;
    try {
      const blob = await squareImage(f, 512);
      this.iconPreview.set(URL.createObjectURL(blob));
      this.iconKey = (await this.api.upload(blob, 'icon.png')).key;
    } catch (e) {
      this.ui.error(e);
    }
  }

  removeIcon() {
    this.iconPreview.set(null);
    this.iconKey = null;
  }

  async saveOverview() {
    this.busy.set(true);
    try {
      const body: Record<string, unknown> = { name: this.name, systemChannelId: this.systemChannelId };
      if (this.iconKey !== undefined) body['icon'] = this.iconKey;
      await this.api.patch(`/guilds/${this.guildId()}`, body);
      this.ui.toast('Alterações salvas.', 'success');
    } catch (e) {
      this.ui.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  roleCount(roleId: number) {
    return Object.values(this.store.members()[this.guildId()] ?? {}).filter((m) => m.roles.includes(roleId)).length;
  }

  selectRole(r: Role) {
    this.editingRole.set(r);
    this.roleDraft = { name: r.name, color: r.color, hoist: r.hoist, admin: r.admin };
  }

  async createRole() {
    try {
      const r = await this.api.post<Role>(`/guilds/${this.guildId()}/roles`, { name: 'novo cargo' });
      this.selectRole(r);
    } catch (e) {
      this.ui.error(e);
    }
  }

  async saveRole(r: Role) {
    try {
      const updated = await this.api.patch<Role>(`/guilds/${this.guildId()}/roles/${r.id}`, this.roleDraft);
      this.editingRole.set(updated);
      this.ui.toast('Cargo salvo.', 'success');
    } catch (e) {
      this.ui.error(e);
    }
  }

  async moveRole(r: Role, dir: 1 | -1) {
    const list = [...this.roles()];
    const i = list.findIndex((x) => x.id === r.id);
    const j = i - dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const n = list.length;
    try {
      await Promise.all(list.map((x, k) => (x.position !== n - k ? this.api.patch(`/guilds/${this.guildId()}/roles/${x.id}`, { position: n - k }) : null)));
    } catch (e) {
      this.ui.error(e);
    }
  }

  async deleteRole(r: Role) {
    const ok = await confirmDialog(this.ui, { title: `Excluir o cargo '${r.name}'`, body: 'Tem certeza? Isso não pode ser desfeito.', confirmText: 'Excluir', danger: true });
    if (!ok) return;
    try {
      await this.api.delete(`/guilds/${this.guildId()}/roles/${r.id}`);
      this.editingRole.set(null);
    } catch (e) {
      this.ui.error(e);
    }
  }

  memberRoles(uid: number) {
    const m = this.store.member(this.guildId(), uid);
    return this.roles().filter((r) => m?.roles.includes(r.id));
  }

  joined(uid: number) {
    const m = this.store.member(this.guildId(), uid);
    return m ? formatLongDate(m.joinedAt) : '';
  }

  memberMenu(e: MouseEvent, u: User) {
    const el = e.currentTarget as Element;
    this.ui.openMenu(e, userMenuItems(u.id, this.guildId(), { store: this.store, ui: this.ui, api: this.api, nav: this.nav, voice: this.voice }, el));
  }

  readonly bots = signal<BotInfo[]>([]);
  readonly newToken = signal<{ name: string; token: string } | null>(null);
  readonly musicBot = computed(() => this.bots().find((b) => b.builtin) ?? null);
  readonly customBots = computed(() => this.bots().filter((b) => !b.builtin));
  readonly origin = location.origin;
  readonly wsOrigin = location.origin.replace(/^http/, 'ws');

  openBots() {
    this.section.set('bots');
    void this.loadBots();
  }

  private async loadBots() {
    try {
      this.bots.set(await this.api.get<BotInfo[]>(`/guilds/${this.guildId()}/bots`));
    } catch (e) {
      this.ui.error(e);
    }
  }

  async addMusicBot() {
    try {
      await this.api.post(`/guilds/${this.guildId()}/bots`, { type: 'music' });
      await this.loadBots();
      this.ui.toast('Bot de música adicionado. Entre num canal de voz e digite /tocar.', 'success');
    } catch (e) {
      this.ui.error(e);
    }
  }

  createBot() {
    promptDialog(this.ui, { title: 'Criar bot', label: 'Nome do bot', placeholder: 'Ex.: Robozinho', confirmText: 'Criar', maxLength: 32 }, async (name) => {
      const bot = await this.api.post<BotInfo>(`/guilds/${this.guildId()}/bots`, { name });
      this.newToken.set({ name: bot.user.displayName, token: bot.token! });
      await this.loadBots();
    });
  }

  async regenerate(b: BotInfo) {
    const ok = await confirmDialog(this.ui, {
      title: 'Gerar novo token',
      body: `O token atual de ${b.user.displayName} para de funcionar e o bot é desconectado até você usar o novo.`,
      confirmText: 'Gerar novo token',
    });
    if (!ok) return;
    try {
      const r = await this.api.post<{ token: string }>(`/guilds/${this.guildId()}/bots/${b.user.id}/token`);
      this.newToken.set({ name: b.user.displayName, token: r.token });
    } catch (e) {
      this.ui.error(e);
    }
  }

  async removeBot(b: BotInfo) {
    const ok = await confirmDialog(this.ui, {
      title: `Remover ${b.user.displayName}`,
      body: b.builtin ? 'O bot de música sai do servidor e para de tocar.' : 'O bot sai do servidor. Você pode adicionar um bot novo depois.',
      confirmText: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.api.delete(`/guilds/${this.guildId()}/bots/${b.user.id}`);
      await this.loadBots();
    } catch (e) {
      this.ui.error(e);
    }
  }

  async copyToken(token: string) {
    await navigator.clipboard.writeText(token);
    this.ui.toast('Token copiado.', 'success');
  }

  openInvites() {
    this.section.set('invites');
    this.api
      .get<{ code: string; uses: number; inviter: User | null }[]>(`/guilds/${this.guildId()}/invites`)
      .then((i) => this.invites.set(i))
      .catch((e) => this.ui.error(e));
  }

  async revoke(code: string) {
    try {
      await this.api.delete(`/invites/${code}`);
      this.invites.update((l) => l.filter((i) => i.code !== code));
    } catch (e) {
      this.ui.error(e);
    }
  }

  openBans() {
    this.section.set('bans');
    this.api
      .get<{ user: User }[]>(`/guilds/${this.guildId()}/bans`)
      .then((b) => this.bans.set(b))
      .catch((e) => this.ui.error(e));
  }

  async unban(userId: number) {
    try {
      await this.api.delete(`/guilds/${this.guildId()}/bans/${userId}`);
      this.bans.update((l) => l.filter((b) => b.user.id !== userId));
    } catch (e) {
      this.ui.error(e);
    }
  }

  deleteGuild() {
    const g = this.guild()!;
    promptDialog(
      this.ui,
      {
        title: `Excluir '${g.name}'`,
        body: `Tem certeza de que deseja excluir ${g.name}? Essa ação não pode ser desfeita. Digite o nome do servidor para confirmar.`,
        label: 'Nome do servidor',
        confirmText: 'Excluir servidor',
      },
      async (v) => {
        if (v !== g.name) throw new Error('O nome não confere.');
        await this.api.delete(`/guilds/${g.id}`);
        this.ui.close();
        this.nav.home();
      },
    );
  }
}
