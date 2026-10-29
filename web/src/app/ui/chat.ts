import { Component, ElementRef, HostListener, Injector, afterNextRender, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { Nav } from '../core/nav';
import { Store } from '../core/store';
import type { Channel, Message } from '../core/types';
import { Ui } from '../core/ui';
import { Voice } from '../core/voice';
import { channelLabel, formatLongDate, sameDay } from '../core/util';
import { ChatState } from './chat-state';
import { Composer } from './composer';
import { MemberList } from './member-list';
import { MessageItem } from './message';
import { PinsPanel, SearchPanel } from './side-panels';
import { Avatar, Icon } from './shared';
import { Tip } from './tooltip';
import { VoiceStage } from './voice-room';
import { ChannelSettings } from './modals/channel-modals';
import { promptDialog } from './modals/dialogs';

interface Row {
  key: string | number;
  m: Message;
  grouped: boolean;
  date: string | null;
  isNew: boolean;
}

const GROUP_WINDOW = 7 * 60_000;

@Component({
  selector: 'app-chat',
  imports: [FormsModule, Composer, MessageItem, MemberList, PinsPanel, SearchPanel, Avatar, Icon, Tip, VoiceStage],
  providers: [ChatState],
  template: `
    @let c = channel();
    <section class="chat" (dragenter)="dragEnter($event)" (dragover)="dragOver($event)" (dragleave)="dragLeave($event)" (drop)="drop($event)">
      <header class="chat-header" [class.searching]="mobileSearch()">
        <button class="icon-btn mobile-only" aria-label="Canais" (click)="ui.mobileNav.set(true)"><app-icon name="menu" /></button>
        @if (c.type === 'dm') {
          <app-avatar [user]="partner()" [size]="24" [status]="store.statusOf(partner()?.id ?? 0)" />
          <h1 class="chat-title" (click)="openPartner($event)">{{ title() }}</h1>
        } @else if (c.type === 'group_dm') {
          <span class="group-icon tiny"><app-icon name="group" [size]="16" /></span>
          <h1 class="chat-title editable" (click)="renameGroup()">{{ title() }}</h1>
        } @else {
          <app-icon class="chat-hash" name="hash" />
          <h1 class="chat-title">{{ c.name }}</h1>
          @if (c.topic) {
            <div class="chat-topic-sep"></div>
            <div class="chat-topic" (click)="topic()">{{ c.topic }}</div>
          }
        }
        <div class="chat-tools">
          @if (c.guildId == null) {
            <button class="icon-btn" appTip="Iniciar chamada de voz" tipSide="bottom" (click)="call(false)"><app-icon name="phone" /></button>
            <button class="icon-btn" appTip="Iniciar chamada de vídeo" tipSide="bottom" (click)="call(true)"><app-icon name="video" /></button>
          }
          <button class="icon-btn" [class.active]="ui.panel() === 'pins'" appTip="Mensagens fixadas" tipSide="bottom" (click)="togglePanel('pins')">
            <app-icon name="pin" />
          </button>
          @if (c.type !== 'dm') {
            <button
              class="icon-btn"
              [class.active]="showMembers() && !ui.panel()"
              appTip="Mostrar lista de membros"
              tipSide="bottom"
              (click)="toggleMembers()"
            >
              <app-icon name="members" />
            </button>
          }
          <button class="icon-btn narrow-only" aria-label="Buscar" (click)="openMobileSearch()"><app-icon name="search" /></button>
          <div class="search-box" [class.focused]="searchFocused()">
            <input
              #searchInput
              placeholder="Buscar"
              [(ngModel)]="searchText"
              (focus)="searchFocused.set(true)"
              (blur)="searchFocused.set(false); !searchText && mobileSearch.set(false)"
              (keydown.enter)="search()"
            />
            <app-icon [name]="searchText ? 'close' : 'search'" [size]="16" (click)="clearSearch()" />
          </div>
        </div>
      </header>

      <div class="chat-body">
        <div class="chat-main">
          @if (inCall()) {
            <app-voice-stage [channel]="c" [compact]="true" />
          }
          <div class="messages scroller" #scroller (scroll)="onScroll()">
            <div class="messages-inner">
              @if (list().loaded && !list().hasMore) {
                <div class="chat-welcome">
                  @if (c.type === 'dm') {
                    <app-avatar [user]="partner()" [size]="80" />
                    <h2>{{ title() }}</h2>
                    <div class="welcome-username">{{ partner()?.username }}</div>
                    <p>Este é o começo do seu histórico de mensagens diretas com <strong>{{ title() }}</strong>.</p>
                  } @else if (c.type === 'group_dm') {
                    <span class="group-icon big"><app-icon name="group" [size]="40" /></span>
                    <h2>{{ title() }}</h2>
                    <p>Boas-vindas ao começo do grupo <strong>{{ title() }}</strong>.</p>
                  } @else {
                    <div class="welcome-hash"><app-icon name="hash" [size]="44" /></div>
                    <h2>Boas-vindas a #{{ c.name }}!</h2>
                    <p>Este é o começo do canal #{{ c.name }}.</p>
                    @if (store.isAdmin(c.guildId)) {
                      <button class="btn-link-inline" (click)="editChannel()"><app-icon name="edit" [size]="16" /> Editar canal</button>
                    }
                  }
                </div>
              } @else if (list().loading || !list().loaded) {
                @for (i of skeleton; track i) {
                  <div class="msg-skeleton">
                    <div class="sk-avatar"></div>
                    <div class="sk-lines">
                      <div class="sk-line" [style.width.px]="80 + ((i * 37) % 90)"></div>
                      <div class="sk-line" [style.width.%]="30 + ((i * 53) % 60)"></div>
                    </div>
                  </div>
                }
              }
              @for (row of rows(); track row.key) {
                @if (row.date) {
                  <div class="divider"><span>{{ row.date }}</span></div>
                }
                @if (row.isNew) {
                  <div class="divider new"><span>NOVAS</span></div>
                }
                <app-message [message]="row.m" [grouped]="row.grouped" />
              }
              <div class="messages-end"></div>
            </div>
          </div>
          @if (showJump()) {
            <div class="jump-present">
              <span>Você está vendo mensagens antigas</span>
              <button (click)="scrollToBottom(true)">Ir para o presente</button>
            </div>
          }
          <app-composer [channel]="c" />
        </div>
        @if (ui.panel() === 'pins') {
          <app-pins-panel [channel]="c" />
        } @else if (ui.panel() === 'search') {
          <app-search-panel [channel]="c" />
        } @else if (c.type !== 'dm' && showMembers()) {
          @if (ui.narrow()) {
            <div class="drawer-scrim" (click)="ui.mobileMembers.set(false)"></div>
          }
          <app-member-list [channel]="c" />
        }
      </div>

      @if (dragging()) {
        <div class="drop-overlay">
          <div class="drop-card">
            <div class="drop-icons">📄🖼️📎</div>
            <h2>Enviar para {{ c.guildId != null ? '#' + c.name : title() }}</h2>
            <p>Você pode adicionar comentários antes de enviar.</p>
          </div>
        </div>
      }
    </section>
  `,
  host: { class: 'chat-host' },
})
export class Chat {
  readonly channel = input.required<Channel>();
  readonly store = inject(Store);
  readonly ui = inject(Ui);
  private nav = inject(Nav);
  private api = inject(Api);
  private voice = inject(Voice);
  private state = inject(ChatState);
  private scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private composer = viewChild(Composer);

  readonly skeleton = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly dragging = signal(false);
  readonly searchFocused = signal(false);
  readonly atBottom = signal(true);
  readonly showJump = signal(false);
  readonly focused = signal(document.hasFocus());
  searchText = '';
  private dragDepth = 0;
  private newMarker = signal<number | null>(null);
  private lastAck = 0;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  readonly list = computed(() => this.store.list(this.channel().id)());
  readonly partner = computed(() => this.store.dmPartner(this.channel()));
  readonly title = computed(() => channelLabel(this.channel(), this.store.users(), this.store.me()?.id));
  readonly inCall = computed(() => this.channel().guildId == null && this.store.voiceIn(this.channel().id).length > 0);

  readonly rows = computed<Row[]>(() => {
    const msgs = this.list().messages;
    const marker = this.newMarker();
    const out: Row[] = [];
    let prev: Message | null = null;
    let markerShown = false;
    for (const m of msgs) {
      const date = !prev || !sameDay(prev.createdAt, m.createdAt) ? formatLongDate(m.createdAt) : null;
      const isNew = !markerShown && marker != null && !m.pending && m.id > marker && m.authorId !== this.store.me()?.id && !!prev;
      if (isNew) markerShown = true;
      const grouped =
        !!prev &&
        !date &&
        !isNew &&
        prev.type === 'default' &&
        m.type === 'default' &&
        prev.authorId === m.authorId &&
        !m.reference &&
        m.createdAt - prev.createdAt < GROUP_WINDOW;
      out.push({ key: m.nonce && m.pending ? m.nonce : m.id, m, grouped, date, isNew });
      prev = m;
    }
    return out;
  });

  constructor() {
    // Entering a channel: load history, remember where "new" starts.
    effect(() => {
      const c = this.channel();
      untracked(() => {
        const rs = this.store.readStates()[c.id];
        this.newMarker.set(this.store.isUnread(c) ? (rs?.lastReadId ?? 0) : null);
        this.state.editingId.set(null);
        this.lastAck = 0;
        this.atBottom.set(true);
        this.showJump.set(false);
        void this.store.loadMessages(c.id).catch((e) => this.ui.error(e));
        setTimeout(() => this.scrollToBottom());
      });
    });

    // Mark as read while the channel is visible and scrolled to the bottom.
    effect(() => {
      const c = this.channel();
      const loaded = this.list().loaded;
      const unread = this.store.isUnread(c) || this.store.mentionCount(c.id) > 0;
      if (!loaded || !unread || !this.focused() || !this.atBottom()) return;
      const last = c.lastMessageId;
      if (!last || last === this.lastAck) return;
      untracked(() => {
        if (this.ackTimer) clearTimeout(this.ackTimer);
        this.ackTimer = setTimeout(() => {
          this.lastAck = last;
          this.store.readStates.update((all) => ({ ...all, [c.id]: { channelId: c.id, lastReadId: last, mentions: 0 } }));
          this.api.post(`/channels/${c.id}/ack`, { messageId: last }).catch(() => (this.lastAck = 0));
        }, 300);
      });
    });

    // Jump to a message (reply click, search result, pins).
    effect(() => {
      const j = this.nav.jumpTo();
      const c = this.channel();
      const loaded = this.list().loaded;
      if (!j || j.channelId !== c.id || !loaded) return;
      untracked(() => void this.jump(j.messageId));
    });
  }

  @HostListener('window:focus')
  onFocus() {
    this.focused.set(true);
  }

  @HostListener('window:blur')
  onBlur() {
    this.focused.set(false);
  }

  private async jump(id: number) {
    this.nav.jumpTo.set(null);
    const c = this.channel();
    for (let i = 0; i < 30 && !this.list().messages.some((m) => m.id === id) && this.list().hasMore; i++) {
      await this.store.loadMessages(c.id, true);
    }
    setTimeout(() => {
      const el = document.getElementById('msg-' + id);
      if (!el) {
        this.ui.toast('Não encontramos essa mensagem.', 'error');
        return;
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      this.state.highlightId.set(id);
      setTimeout(() => this.state.highlightId.set(null), 2000);
    }, 50);
  }

  // The scroller is flex column-reverse: scrollTop is 0 at the bottom, negative above.
  onScroll() {
    const el = this.scroller()?.nativeElement;
    if (!el) return;
    const fromBottom = -el.scrollTop;
    this.atBottom.set(fromBottom < 40);
    this.showJump.set(fromBottom > 2000);
    const fromTop = el.scrollHeight - el.clientHeight - fromBottom;
    if (fromTop < 400 && this.list().hasMore && !this.list().loading && this.list().loaded) {
      void this.store.loadMessages(this.channel().id, true).catch((e) => this.ui.error(e));
    }
  }

  scrollToBottom(smooth = false) {
    const el = this.scroller()?.nativeElement;
    if (el) el.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  }

  togglePanel(p: 'pins' | 'search') {
    this.ui.panel.set(this.ui.panel() === p ? null : p);
  }

  /** Beside the chat on wide screens; a drawer that starts closed on narrow ones. */
  readonly showMembers = computed(() => (this.ui.narrow() ? this.ui.mobileMembers() : this.ui.memberList()));
  readonly mobileSearch = signal(false);
  private injector = inject(Injector);
  private searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  openMobileSearch() {
    this.mobileSearch.set(true);
    afterNextRender(() => this.searchInput()?.nativeElement.focus(), { injector: this.injector });
  }

  toggleMembers() {
    if (this.ui.narrow()) {
      this.ui.panel.set(null);
      this.ui.mobileMembers.update((v) => !v);
      return;
    }
    if (this.ui.panel()) {
      this.ui.panel.set(null);
      if (!this.ui.memberList()) this.ui.toggleMemberList();
    } else {
      this.ui.toggleMemberList();
    }
  }

  search() {
    const q = this.searchText.trim();
    if (!q) return;
    this.ui.searchQuery.set(q);
    this.ui.panel.set('search');
    // On phones the results cover the chat; the header goes back to normal behind them.
    this.mobileSearch.set(false);
  }

  clearSearch() {
    this.searchText = '';
    if (this.ui.panel() === 'search') this.ui.panel.set(null);
  }

  openPartner(e: MouseEvent) {
    const p = this.partner();
    if (p) this.ui.openProfile(p.id, null, e.currentTarget as Element);
  }

  topic() {
    const c = this.channel();
    this.ui.toast(c.topic, 'info');
  }

  editChannel() {
    this.ui.open(ChannelSettings, { channelId: this.channel().id });
  }

  renameGroup() {
    const c = this.channel();
    promptDialog(this.ui, { title: 'Renomear grupo', label: 'Nome do grupo', initial: c.name, maxLength: 100 }, (name) =>
      this.api.patch(`/channels/${c.id}`, { name }),
    );
  }

  async call(video: boolean) {
    const c = this.channel();
    await this.voice.join(c.id, null);
    if (video && !this.voice.localCamera()) await this.voice.toggleCamera();
  }

  // ---------------------------------------------------------------- drag & drop

  private hasFiles(e: DragEvent) {
    return [...(e.dataTransfer?.types ?? [])].includes('Files');
  }

  dragEnter(e: DragEvent) {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  dragOver(e: DragEvent) {
    if (this.hasFiles(e)) e.preventDefault();
  }

  dragLeave(e: DragEvent) {
    if (!this.hasFiles(e)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging.set(false);
  }

  drop(e: DragEvent) {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) this.composer()?.addFiles(files);
  }
}
