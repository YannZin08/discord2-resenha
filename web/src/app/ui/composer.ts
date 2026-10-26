import { Component, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { searchEmojis } from '../core/emoji';
import { Gateway } from '../core/gateway';
import { twemojiUrl } from '../core/markdown';
import { Store } from '../core/store';
import type { Attachment, Channel, Message, PendingFile } from '../core/types';
import { Ui } from '../core/ui';
import { channelLabel, formatSize, imageSize, isImage, uid } from '../core/util';
import { ChatState, Drafts } from './chat-state';
import { toWire } from './message';
import { Autosize, Avatar, Icon } from './shared';
import { Tip } from './tooltip';

const MAX = 4000;

interface Suggestion {
  key: string;
  label: string;
  sub?: string;
  insert: string;
  userId?: number;
  emoji?: string;
  icon?: string;
}

@Component({
  selector: 'app-composer',
  imports: [FormsModule, Icon, Avatar, Tip, Autosize],
  template: `
    @if (blocked()) {
      <div class="composer-blocked">Você não pode mandar mensagens para um usuário bloqueado.</div>
    } @else {
      <form class="composer" (submit)="$event.preventDefault()">
        @if (suggestions().length) {
          <div class="autocomplete">
            <div class="ac-title">{{ acTitle() }}</div>
            @for (s of suggestions(); track s.key) {
              <div class="ac-item" [class.active]="$index === acIndex()" (mousedown)="$event.preventDefault(); applySuggestion(s)" (mouseenter)="acIndex.set($index)">
                @if (s.userId != null) {
                  <app-avatar [user]="store.users()[s.userId]" [size]="24" [status]="store.statusOf(s.userId)" />
                } @else if (s.emoji) {
                  <img class="emoji" [src]="emojiUrl(s.emoji)" [alt]="s.emoji" />
                } @else if (s.icon) {
                  <app-icon [name]="s.icon" [size]="20" />
                }
                <span class="ac-label">{{ s.label }}</span>
                @if (s.sub) {
                  <span class="ac-sub">{{ s.sub }}</span>
                }
              </div>
            }
          </div>
        }
        @if (chat.replyTo(); as r) {
          <div class="reply-bar">
            <span>Respondendo a <strong>{{ store.nameIn(r.guildId, r.authorId) }}</strong></span>
            <button type="button" (click)="chat.replyTo.set(null)" appTip="Cancelar resposta"><app-icon name="close" [size]="16" /></button>
          </div>
        }
        @if (files().length) {
          <div class="upload-tray scroller thin">
            @for (f of files(); track f.id) {
              <div class="upload-card">
                <div class="upload-preview">
                  @if (f.preview) {
                    <img [src]="f.preview" alt="" />
                  } @else {
                    <app-icon name="file" [size]="48" />
                  }
                </div>
                <div class="upload-name">{{ f.name }}</div>
                <div class="upload-size">{{ size(f.file.size) }}</div>
                <button type="button" class="upload-remove" appTip="Remover anexo" (click)="removeFile(f.id)"><app-icon name="trash" [size]="18" /></button>
              </div>
            }
          </div>
        }
        <div class="composer-row" [class.has-top]="!!chat.replyTo() || files().length">
          <button type="button" class="composer-btn attach" appTip="Enviar arquivo" (click)="fileInput.click()"><app-icon name="addCircle" /></button>
          <input #fileInput type="file" multiple hidden (change)="pickFiles($event)" />
          <textarea
            #box
            appAutosize
            rows="1"
            [placeholder]="placeholder()"
            [value]="text()"
            (input)="onInput($any($event.target).value)"
            (keydown)="onKey($event)"
            (paste)="onPaste($event)"
            (click)="updateSuggestions()"
            (blur)="blurSuggestions()"
          ></textarea>
          @if (text().length > MAX - 200) {
            <span class="char-count" [class.over]="text().length > MAX">{{ MAX - text().length }}</span>
          }
          <button type="button" class="composer-btn emoji-btn" appTip="Escolher um emoji" (click)="openPicker($event)"><app-icon name="smile" /></button>
        </div>
      </form>
    }
    <div class="typing">
      @if (typingText(); as t) {
        <span class="typing-dots"><i></i><i></i><i></i></span> <span [innerHTML]="t"></span>
      }
    </div>
  `,
  host: { class: 'composer-host' },
})
export class Composer {
  readonly channel = input.required<Channel>();
  readonly store = inject(Store);
  readonly chat = inject(ChatState);
  private api = inject(Api);
  private ui = inject(Ui);
  private gateway = inject(Gateway);
  private drafts = inject(Drafts);
  private box = viewChild<ElementRef<HTMLTextAreaElement>>('box');

  readonly MAX = MAX;
  readonly text = signal('');
  readonly files = signal<PendingFile[]>([]);
  readonly suggestions = signal<Suggestion[]>([]);
  readonly acIndex = signal(0);
  readonly acTitle = signal('');
  private acRange: [number, number] | null = null;
  private lastTyping = 0;

  readonly blocked = computed(() => {
    const p = this.store.dmPartner(this.channel());
    return p ? this.store.relationships()[p.id] === 'blocked' : false;
  });

  readonly placeholder = computed(() => {
    const c = this.channel();
    if (c.type === 'dm') return `Conversar com @${channelLabel(c, this.store.users(), this.store.me()?.id)}`;
    if (c.type === 'group_dm') return `Conversar em ${channelLabel(c, this.store.users(), this.store.me()?.id)}`;
    return `Conversar em #${c.name}`;
  });

  readonly typingText = computed(() => {
    const c = this.channel();
    const me = this.store.me()?.id;
    const ids = Object.keys(this.store.typing()[c.id] ?? {})
      .map(Number)
      .filter((id) => id !== me);
    if (!ids.length) return '';
    const names = ids.map((id) => `<strong>${escape(this.store.nameIn(c.guildId, id))}</strong>`);
    if (names.length === 1) return `${names[0]} está digitando...`;
    if (names.length <= 3) return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]} estão digitando...`;
    return 'Várias pessoas estão digitando...';
  });

  constructor() {
    // Swap drafts when the channel changes.
    let current: number | null = null;
    effect(() => {
      const id = this.channel().id;
      untracked(() => {
        if (current != null) this.drafts.set(current, this.text());
        current = id;
        this.text.set(this.drafts.get(id));
        this.files.set([]);
        this.chat.replyTo.set(null);
        this.suggestions.set([]);
        setTimeout(() => {
          this.resize();
          this.focus();
        });
      });
    });
    this.chat.focusComposer = () => this.focus();
    this.chat.retry = (m) => void this.deliver(m);
  }

  ngOnDestroy() {
    this.drafts.set(this.channel().id, this.text());
  }

  focus() {
    const el = this.box()?.nativeElement;
    if (el && window.matchMedia('(pointer: fine)').matches) el.focus();
  }

  private resize() {
    const el = this.box()?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 400) + 'px';
  }

  size(n: number) {
    return formatSize(n);
  }

  emojiUrl(e: string) {
    return twemojiUrl(e);
  }

  onInput(v: string) {
    this.text.set(v);
    this.updateSuggestions();
    if (v.trim() && Date.now() - this.lastTyping > 8000) {
      this.lastTyping = Date.now();
      this.gateway.send({ op: 'typing', channelId: this.channel().id });
    }
  }

  // ---------------------------------------------------------------- autocomplete

  updateSuggestions() {
    const el = this.box()?.nativeElement;
    if (!el) return;
    const caret = el.selectionStart ?? this.text().length;
    const before = this.text().slice(0, caret);
    const m = before.match(/(?:^|\s)([@#:])([^\s@#:]{0,32})$/u);
    if (!m) {
      this.suggestions.set([]);
      return;
    }
    const [, trigger, q] = m;
    const query = q.toLowerCase();
    const start = caret - q.length - 1;
    this.acRange = [start, caret];
    const c = this.channel();
    let list: Suggestion[] = [];
    if (trigger === '@') {
      this.acTitle.set('Membros');
      const ids = c.guildId != null ? Object.keys(this.store.members()[c.guildId] ?? {}).map(Number) : (c.recipients ?? []);
      list = ids
        .map((id) => this.store.users()[id])
        .filter((u) => u && (u.username.includes(query) || this.store.nameIn(c.guildId, u.id).toLowerCase().includes(query)))
        .slice(0, 10)
        .map((u) => ({ key: 'u' + u.id, label: this.store.nameIn(c.guildId, u.id), sub: u.username, insert: '@' + u.username + ' ', userId: u.id }));
      if (c.guildId != null) {
        for (const kw of ['everyone', 'here']) {
          if (kw.startsWith(query)) list.push({ key: kw, label: '@' + kw, sub: kw === 'everyone' ? 'Notifica todo mundo' : 'Notifica quem está online', insert: '@' + kw + ' ' });
        }
      }
    } else if (trigger === '#') {
      if (c.guildId == null) return this.suggestions.set([]);
      this.acTitle.set('Canais de texto');
      list = this.store
        .guildChannels(c.guildId)
        .filter((x) => x.type === 'text' && x.name.includes(query))
        .slice(0, 10)
        .map((x) => ({ key: 'c' + x.id, label: x.name, insert: '#' + x.name + ' ', icon: 'hash' }));
    } else {
      if (query.length < 2) return this.suggestions.set([]);
      this.acTitle.set(`Emojis correspondentes a :${q}`);
      list = searchEmojis(query, 10).map((e) => ({ key: e.char, label: `:${e.name}:`, insert: e.char + ' ', emoji: e.char }));
    }
    this.suggestions.set(list);
    this.acIndex.set(0);
  }

  blurSuggestions() {
    setTimeout(() => this.suggestions.set([]), 100);
  }

  applySuggestion(s: Suggestion) {
    if (!this.acRange) return;
    const [a, b] = this.acRange;
    const t = this.text();
    const next = t.slice(0, a) + s.insert + t.slice(b);
    this.text.set(next);
    this.suggestions.set([]);
    const caret = a + s.insert.length;
    setTimeout(() => {
      const el = this.box()?.nativeElement;
      if (!el) return;
      el.value = next;
      el.setSelectionRange(caret, caret);
      el.focus();
      this.resize();
    });
  }

  // ---------------------------------------------------------------- keys

  onKey(e: KeyboardEvent) {
    const sugg = this.suggestions();
    if (sugg.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        this.acIndex.set((this.acIndex() + d + sugg.length) % sugg.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        this.applySuggestion(sugg[this.acIndex()]);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.suggestions.set([]);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void this.send();
      return;
    }
    if (e.key === 'Escape' && this.chat.replyTo()) {
      e.stopPropagation();
      this.chat.replyTo.set(null);
      return;
    }
    if (e.key === 'ArrowUp' && !this.text()) {
      const me = this.store.me()?.id;
      const msgs = this.store.list(this.channel().id)().messages;
      const last = [...msgs].reverse().find((m) => m.authorId === me && m.type === 'default' && !m.pending);
      if (last) {
        e.preventDefault();
        this.chat.editingId.set(last.id);
      }
    }
  }

  // ---------------------------------------------------------------- files

  pickFiles(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) this.addFiles([...input.files]);
    input.value = '';
  }

  onPaste(e: ClipboardEvent) {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      this.addFiles(files);
    }
  }

  addFiles(list: File[]) {
    const next = [...this.files()];
    for (const file of list) {
      if (next.length >= 10) {
        this.ui.toast('Você pode enviar até 10 arquivos por vez.', 'error');
        break;
      }
      if (file.size > 25 * 1024 * 1024) {
        this.ui.toast(`${file.name} passa do limite de 25 MB.`, 'error');
        continue;
      }
      const name = file.name || `imagem-${Date.now()}.png`;
      next.push({ id: uid(), file, name, preview: isImage(file.type) ? URL.createObjectURL(file) : null });
    }
    this.files.set(next);
    this.focus();
  }

  removeFile(id: string) {
    const f = this.files().find((x) => x.id === id);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    this.files.update((list) => list.filter((x) => x.id !== id));
  }

  openPicker(e: MouseEvent) {
    this.ui.openPicker(
      e.currentTarget as Element,
      (emoji) => {
        const el = this.box()?.nativeElement;
        const t = this.text();
        const pos = el?.selectionStart ?? t.length;
        const next = t.slice(0, pos) + emoji + t.slice(pos);
        this.text.set(next);
        setTimeout(() => {
          if (!el) return;
          el.value = next;
          el.setSelectionRange(pos + emoji.length, pos + emoji.length);
          el.focus();
        });
      },
      true,
    );
  }

  // ---------------------------------------------------------------- send

  async send() {
    const c = this.channel();
    const raw = this.text().trim();
    const files = this.files();
    if (!raw && !files.length) return;
    if (raw.length > MAX) {
      this.ui.toast(`A mensagem pode ter no máximo ${MAX} caracteres.`, 'error');
      return;
    }
    const me = this.store.me()!;
    const content = toWire(raw, this.store, c.guildId, c.recipients);
    const reply = this.chat.replyTo();
    const nonce = uid();
    const pending: Message = {
      id: Number.MAX_SAFE_INTEGER,
      channelId: c.id,
      guildId: c.guildId,
      authorId: me.id,
      author: me,
      type: 'default',
      content,
      createdAt: Date.now(),
      editedAt: null,
      replyTo: reply?.id ?? null,
      reference: reply ? { id: reply.id, authorId: reply.authorId, author: reply.author, content: reply.content } : null,
      pinned: false,
      mentions: [],
      mentionEveryone: false,
      attachments: [],
      embeds: [],
      reactions: [],
      nonce,
      pending: true,
      localFiles: files,
    };
    this.text.set('');
    this.files.set([]);
    this.chat.replyTo.set(null);
    this.drafts.set(c.id, '');
    setTimeout(() => this.resize());
    this.lastTyping = 0;
    this.store.addPending(pending);
    await this.deliver(pending);
  }

  /** Uploads files (if any) then posts the message; marks it failed on error. */
  readonly deliver = async (m: Message) => {
    const c = m.channelId;
    this.store.patchPending(c, m.nonce!, (x) => ({ ...x, failed: false }));
    try {
      const attachments: Partial<Attachment>[] = [];
      for (const f of m.localFiles ?? []) {
        const dims = await imageSize(f.file);
        const up = await this.api.upload(f.file, f.name, (p) => this.chat.uploadProgress.update((all) => ({ ...all, [f.id]: p })));
        attachments.push({ key: up.key, width: dims?.width ?? null, height: dims?.height ?? null });
        if (f.preview) URL.revokeObjectURL(f.preview);
      }
      const sent = await this.api.post<Message>(`/channels/${c}/messages`, {
        content: m.content,
        replyTo: m.replyTo,
        attachments,
        nonce: m.nonce,
      });
      // The gateway usually delivers it first; if not, swap the pending copy now.
      this.store.patchPending(c, m.nonce!, () => null);
      this.store.dispatch('MESSAGE_CREATE', { ...sent, nonce: m.nonce });
    } catch (e) {
      this.store.patchPending(c, m.nonce!, (x) => ({ ...x, failed: true }));
      this.ui.error(e);
    }
  };
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
