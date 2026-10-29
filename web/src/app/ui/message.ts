import { Component, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { Api } from '../core/api';
import { shortcodeEmoji } from '../core/emoji';
import { CUSTOM_TOKEN, customToken, emojiLabel, emojiSrc, reactionKey } from '../core/custom-emoji';
import { escapeHtml, isJumbo, renderMarkdown } from '../core/markdown';
import { Nav } from '../core/nav';
import { Prefs } from '../core/prefs';
import { Store } from '../core/store';
import type { Attachment, Embed, Message, Reaction } from '../core/types';
import { MenuItem, Ui } from '../core/ui';
import {
  copyText,
  fileUrl,
  fitSize,
  formatSize,
  formatTime,
  formatTimestamp,
  formatTooltipDate,
  isAudio,
  isImage,
  isVideo,
  youtubeId,
} from '../core/util';
import { Voice } from '../core/voice';
import { ChatState } from './chat-state';
import { userMenuItems } from './menus';
import { confirmDialog } from './modals/dialogs';
import { Autofocus, Autosize, Avatar, Icon } from './shared';
import { Tip } from './tooltip';

const JOIN_LINES = [
  '{u} acabou de chegar. Diga oi!',
  'Boas-vindas, {u}. Esperamos que você tenha trazido pizza.',
  '{u} chegou na resenha.',
  'Um {u} selvagem apareceu.',
  '{u} pousou no servidor.',
  'Que bom te ver, {u}!',
  '{u} entrou na festa.',
];

const LEAVE_LINES = ['{u} saiu do servidor.', '{u} foi embora da resenha.', '{u} deu tchau.', '{u} saiu de fininho.'];

/** Converts stored <@id> mentions back to editable @username text. */
export function toEditable(content: string, store: Store): string {
  return content
    .replace(/<@(\d+)>/g, (m, id: string) => {
      const u = store.users()[+id];
      return u ? '@' + u.username : m;
    })
    .replace(/<#(\d+)>/g, (m, id: string) => {
      const c = store.channels()[+id];
      return c ? '#' + c.name : m;
    })
    .replace(CUSTOM_TOKEN, (m, _a: string, name: string, id: string) => (customByName(store, guildId0(store, +id), name)?.id === +id ? `:${name}:` : m));
}

/** The server an emoji belongs to, if it's one of mine. */
function guildId0(store: Store, emojiId: number): number | null {
  return store.customEmojis().find((e) => e.id === emojiId)?.guildId ?? null;
}

/**
 * A custom emoji by :name:, in the order a typed :name: finds it: this server's, then my own,
 * then (unless `others` is false) any other server's I'm in.
 */
export function customByName(store: Store, guildId: number | null, name: string, others = true) {
  const all = store.customEmojis().filter((e) => e.name === name);
  return (
    (guildId != null ? all.find((e) => e.guildId === guildId) : undefined) ??
    all.find((e) => e.guildId === null) ??
    (others ? all[0] : undefined)
  );
}

/** Converts typed @username / #channel back to <@id> / <#id>, and :shortcodes: to emojis. */
export function toWire(text: string, store: Store, guildId: number | null, recipients: number[] = []): string {
  const users = store.users();
  const byName = new Map<string, number>();
  const ids = guildId != null ? Object.keys(store.members()[guildId] ?? {}).map(Number) : recipients;
  for (const id of ids) if (users[id]) byName.set(users[id].username.toLowerCase(), id);
  // :nome: → this server's emoji, else my own, else the Unicode one (:joy:), else another
  // server's. Names already inside a <:nome:id> token are left alone.
  let out = text.replace(/(?<!<a?):([A-Za-z0-9_+-]{2,40}):/g, (m, name: string) => {
    const own = customByName(store, guildId, name, false);
    if (own) return customToken(own);
    const unicode = shortcodeEmoji(name);
    if (unicode) return unicode;
    const any = customByName(store, guildId, name);
    return any ? customToken(any) : m;
  });
  out = out.replace(/(^|[^\w<])@([a-z0-9_.]{2,32})/gi, (m, pre: string, name: string) => {
    const id = byName.get(name.toLowerCase().replace(/\.$/, ''));
    return id ? `${pre}<@${id}>${name.endsWith('.') ? '.' : ''}` : m;
  });
  if (guildId != null) {
    const chans = store.guildChannels(guildId).filter((c) => c.type === 'text');
    out = out.replace(/(^|[^\w<&])#([\p{L}\p{N}_-]{1,100})/gu, (m, pre: string, name: string) => {
      const c = chans.find((x) => x.name === name.toLowerCase());
      return c ? `${pre}<#${c.id}>` : m;
    });
  }
  return out;
}

@Component({
  selector: 'app-message',
  imports: [Avatar, Icon, Tip, FormsModule, Autosize, Autofocus],
  template: `
    @let m = message();
    @if (m.type !== 'default') {
      <div class="message system" [id]="'msg-' + m.id" [class.highlight]="highlighted()" (contextmenu)="menu($event)">
        <span class="system-icon" [class]="'system-' + m.type">
          @switch (m.type) {
            @case ('join') {
              <app-icon name="arrowRight" [size]="16" />
            }
            @case ('leave') {
              <app-icon name="logout" [size]="16" />
            }
            @case ('call') {
              <app-icon name="phone" [size]="16" />
            }
            @case ('pin') {
              <app-icon name="pin" [size]="16" />
            }
          }
        </span>
        <div class="system-text">
          @switch (m.type) {
            @case ('join') {
              <span [innerHTML]="joinHtml()"></span>
            }
            @case ('leave') {
              <span [innerHTML]="joinHtml()"></span>
            }
            @case ('call') {
              <span><a class="msg-author-inline" (click)="profile($event)">{{ authorName() }}</a> iniciou uma chamada.</span>
            }
            @case ('pin') {
              <span
                ><a class="msg-author-inline" (click)="profile($event)">{{ authorName() }}</a> fixou
                <a (click)="jumpToRef()">uma mensagem</a> neste canal.</span
              >
            }
          }
          <span class="msg-time" [appTip]="fullTime()">{{ timestamp() }}</span>
        </div>
      </div>
    } @else {
      <div
        class="message"
        [id]="'msg-' + m.id"
        [class.grouped]="grouped()"
        [class.mine]="isMine()"
        [class.fresh]="fresh()"
        [class.mentioned]="mentioned()"
        [class.pending]="m.pending && !m.failed"
        [class.failed]="m.failed"
        [class.highlight]="highlighted()"
        [class.editing]="editing()"
        [class.replying]="chat.replyTo()?.id === m.id"
        (contextmenu)="menu($event)"
      >
        @if (m.reference; as ref) {
          <div class="reply-ref" (click)="jumpToRef()">
            <span class="reply-spine"></span>
            @if (ref.deleted) {
              <span class="reply-text muted">A mensagem original foi apagada</span>
            } @else {
              <app-avatar [user]="ref.author" [size]="16" />
              <span class="reply-name" [style.color]="refColor()">&#64;{{ refName() }}</span>
              <span class="reply-text" [innerHTML]="refHtml()"></span>
            }
          </div>
        }
        @if (!grouped()) {
          <div class="msg-avatar" (click)="profile($event)" (contextmenu)="authorMenu($event)">
            <app-avatar [user]="m.author" [size]="40" />
          </div>
          <h3 class="msg-header">
            <span class="msg-author" [style.color]="authorColor()" (click)="profile($event)" (contextmenu)="authorMenu($event)">{{ authorName() }}</span>
            @if (m.author?.bot) {
              <span class="bot-tag">BOT</span>
            }
            <span class="msg-time" [appTip]="fullTime()">{{ timestamp() }}</span>
          </h3>
        } @else {
          <span class="msg-hover-time" [appTip]="fullTime()">{{ shortTime() }}</span>
        }

        @if (editing()) {
          <div class="msg-edit">
            <div class="textarea-wrap">
              <textarea
                appAutosize
                appAutofocus
                rows="1"
                [(ngModel)]="editText"
                (keydown)="editKey($event)"
              ></textarea>
            </div>
            <div class="edit-hint">esc para <a (click)="cancelEdit()">cancelar</a> • enter para <a (click)="saveEdit()">salvar</a></div>
          </div>
        } @else if (m.content) {
          <div class="msg-content" [class.jumbo]="jumbo()" [innerHTML]="html()" (click)="contentClick($event)"></div>
        }

        @if (m.attachments.length || m.localFiles?.length) {
          <div class="attachments">
            @for (a of m.attachments; track a.key) {
              @if (isImage(a.mime)) {
                <div class="att-image" [style.width.px]="size(a)?.width" [style.height.px]="size(a)?.height" (click)="openImage(a)">
                  <img [src]="url(a)" [alt]="a.name" loading="lazy" />
                </div>
              } @else if (isVideo(a.mime)) {
                <video class="att-video" [src]="url(a)" controls preload="metadata" [style.max-width.px]="400"></video>
              } @else if (isAudio(a.mime)) {
                <div class="att-file audio">
                  <div class="att-file-row">
                    <app-icon name="file" [size]="32" />
                    <div class="att-file-info">
                      <a [href]="url(a)" target="_blank" rel="noopener">{{ a.name }}</a>
                      <span>{{ formatSize(a.size) }}</span>
                    </div>
                  </div>
                  <audio [src]="url(a)" controls preload="metadata"></audio>
                </div>
              } @else {
                <div class="att-file">
                  <div class="att-file-row">
                    <app-icon name="file" [size]="32" />
                    <div class="att-file-info">
                      <a [href]="url(a)" target="_blank" rel="noopener">{{ a.name }}</a>
                      <span>{{ formatSize(a.size) }}</span>
                    </div>
                    <a class="att-download" [href]="url(a)" [attr.download]="a.name" appTip="Baixar"><app-icon name="download" /></a>
                  </div>
                </div>
              }
            }
            @for (f of m.localFiles ?? []; track f.id) {
              <div class="att-file uploading">
                <div class="att-file-row">
                  <app-icon name="file" [size]="32" />
                  <div class="att-file-info">
                    <span class="att-name">{{ f.name }}</span>
                    <div class="progress"><div class="progress-bar" [style.width.%]="(chat.uploadProgress()[f.id] || 0) * 100"></div></div>
                  </div>
                </div>
              </div>
            }
          </div>
        }

        @for (e of m.embeds; track $index) {
          @if (e.type === 'image' && e.image) {
            <div class="embed-image-only" (click)="ui.lightbox.set({ src: e.image, name: e.url })"><img [src]="e.image" alt="" loading="lazy" /></div>
          } @else if (e.type === 'link') {
            <div class="embed" [style.border-left-color]="e.color || 'var(--bg-tertiary)'">
              @if (e.siteName) {
                <div class="embed-site">{{ e.siteName }}</div>
              }
              @if (e.title) {
                <a class="embed-title" [href]="e.url" target="_blank" rel="noopener noreferrer">{{ e.title }}</a>
              }
              @if (e.description && !yt(e)) {
                <div class="embed-desc">{{ e.description }}</div>
              }
              @if (yt(e); as vid) {
                @if (playing() === vid) {
                  <iframe class="embed-video" [src]="ytSrc(vid)" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
                } @else {
                  <div class="embed-video-thumb" (click)="playing.set(vid)">
                    <img [src]="e.image || 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg'" alt="" loading="lazy" />
                    <span class="play-btn">▶</span>
                  </div>
                }
              } @else if (e.image) {
                <img class="embed-thumb" [src]="e.image" alt="" loading="lazy" (click)="ui.lightbox.set({ src: e.image, name: e.title || e.url })" />
              }
            </div>
          }
        }

        @if (m.reactions.length) {
          <div class="reactions">
            @for (r of m.reactions; track r.emoji) {
              <button class="reaction" [class.me]="reacted(r)" (click)="toggleReaction(r.emoji)" [appTip]="reactors(r)">
                <img class="emoji" [src]="emojiUrl(r.emoji)" [alt]="emojiLabel(r.emoji)" />
                <span>{{ r.users.length }}</span>
              </button>
            }
            <button class="reaction add" appTip="Adicionar reação" (click)="pickReaction($event)"><app-icon name="addReaction" [size]="16" /></button>
          </div>
        }

        @if (m.failed) {
          <div class="msg-failed">
            Não foi possível enviar a mensagem.
            <a (click)="chat.retry(m)">Tentar de novo</a> ·
            <a (click)="discard()">Descartar</a>
          </div>
        }

        @if (!m.pending && !editing()) {
          <div class="msg-toolbar">
            @for (e of quickReactions(); track e) {
              <button class="quick-react" (click)="toggleReaction(e)"><img [src]="emojiUrl(e)" [alt]="emojiLabel(e)" /></button>
            }
            <button appTip="Adicionar reação" (click)="pickReaction($event)"><app-icon name="addReaction" [size]="20" /></button>
            @if (isMine()) {
              <button appTip="Editar" (click)="startEdit()"><app-icon name="edit" [size]="20" /></button>
            } @else {
              <button appTip="Responder" (click)="reply()"><app-icon name="reply" [size]="20" /></button>
            }
            <button appTip="Mais" (click)="menu($event)"><app-icon name="more" [size]="20" /></button>
          </div>
        }
      </div>
    }
  `,
})
export class MessageItem {
  readonly message = input.required<Message>();
  readonly grouped = input(false);

  readonly store = inject(Store);
  readonly ui = inject(Ui);
  readonly chat = inject(ChatState);
  private api = inject(Api);
  private nav = inject(Nav);
  private voice = inject(Voice);
  private prefs = inject(Prefs);
  private sanitizer = inject(DomSanitizer);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly playing = signal<string | null>(null);
  editText = '';

  readonly editing = computed(() => this.chat.editingId() === this.message().id);
  readonly highlighted = computed(() => this.chat.highlightId() === this.message().id);
  readonly isMine = computed(() => this.message().authorId === this.store.me()?.id);
  /**
   * Just arrived (slides in). Your own message animates once, while sending: when the server
   * confirms it, it's drawn again under its real id and must not animate a second time.
   */
  readonly fresh = computed(() => {
    const m = this.message();
    return Date.now() - m.createdAt < 8000 && (!!m.pending || !this.isMine());
  });
  readonly mentioned = computed(() => {
    const m = this.message();
    const me = this.store.me()?.id;
    return m.authorId !== me && m.guildId != null && (m.mentionEveryone || (me != null && m.mentions.includes(me)));
  });
  readonly authorName = computed(() => {
    const m = this.message();
    const u = this.store.users()[m.authorId] ?? m.author;
    return this.store.member(m.guildId, m.authorId)?.nick || u?.displayName || 'Usuário desconhecido';
  });
  readonly authorColor = computed(() => this.store.colorIn(this.message().guildId, this.message().authorId));
  readonly timestamp = computed(() => formatTimestamp(this.message().createdAt));
  readonly shortTime = computed(() => formatTime(this.message().createdAt));
  readonly fullTime = computed(() => formatTooltipDate(this.message().createdAt));
  readonly jumbo = computed(() => isJumbo(this.message().content));
  readonly quickReactions = computed(() => this.prefs.data().recentEmojis.slice(0, 3));

  readonly html = computed<SafeHtml>(() => {
    const m = this.message();
    let out = renderMarkdown(m.content, {
      userName: (id) => (this.store.users()[id] ? this.store.nameIn(m.guildId, id) : null),
      channelName: (id) => this.store.channels()[id]?.name ?? null,
      meId: this.store.me()?.id,
    });
    if (m.editedAt) out += `<span class="edited" title="${escapeHtml(formatTooltipDate(m.editedAt))}">(editado)</span>`;
    return this.sanitizer.bypassSecurityTrustHtml(out);
  });

  readonly refName = computed(() => {
    const ref = this.message().reference;
    if (!ref?.authorId) return '';
    return this.store.nameIn(this.message().guildId, ref.authorId) || ref.author?.displayName || '';
  });
  readonly refColor = computed(() => {
    const ref = this.message().reference;
    return ref?.authorId ? this.store.colorIn(this.message().guildId, ref.authorId) : null;
  });
  readonly refHtml = computed<SafeHtml>(() => {
    const ref = this.message().reference;
    if (!ref) return '';
    const m = this.message();
    const text = (ref.content ?? '').replace(/\n+/g, ' ');
    const html = text
      ? renderMarkdown(text, {
          userName: (id) => (this.store.users()[id] ? this.store.nameIn(m.guildId, id) : null),
          channelName: (id) => this.store.channels()[id]?.name ?? null,
          meId: this.store.me()?.id,
        })
      : `<em>${ref.hasAttachments ? 'Clique para ver o anexo' : 'Clique para ver a mensagem'}</em>`;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });
  readonly joinHtml = computed<SafeHtml>(() => {
    const m = this.message();
    const lines = m.type === 'leave' ? LEAVE_LINES : JOIN_LINES;
    const line = lines[Math.floor(m.id / 4096) % lines.length];
    const name = `<a class="msg-author-inline" data-user="${m.authorId}">${escapeHtml(this.authorName())}</a>`;
    return this.sanitizer.bypassSecurityTrustHtml(escapeHtml(line).replace('{u}', name));
  });

  constructor() {
    effect(() => {
      if (this.editing()) this.editText = toEditable(this.message().content, this.store);
    });
    // Clicks on the join message's name open the profile.
    this.host.nativeElement.addEventListener('click', (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.system .msg-author-inline[data-user]');
      if (el) this.ui.openProfile(+el.dataset['user']!, this.message().guildId, el);
    });
  }

  isImage = isImage;
  isVideo = isVideo;
  isAudio = isAudio;
  formatSize = formatSize;

  url(a: Attachment) {
    return fileUrl(a.key, a.name);
  }

  size(a: Attachment) {
    return fitSize(a.width, a.height);
  }

  readonly emojiLabel = emojiLabel;

  emojiUrl(e: string) {
    return emojiSrc(e);
  }

  yt(e: Embed) {
    return youtubeId(e.url);
  }

  ytSrc(id: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`);
  }

  openImage(a: Attachment) {
    this.ui.lightbox.set({ src: this.url(a), name: a.name });
  }

  reacted(r: Reaction) {
    return r.users.includes(this.store.me()?.id ?? -1);
  }

  reactors(r: Reaction) {
    const names = r.users.slice(0, 5).map((u) => this.store.nameIn(this.message().guildId, u));
    const more = r.users.length > 5 ? ` e mais ${r.users.length - 5}` : '';
    return `${names.join(', ')}${more} reagiu com ${emojiLabel(r.emoji)}`;
  }

  /** Takes any emoji the picker gives (Unicode or a custom <:nome:id>). */
  toggleReaction(picked: string) {
    const emoji = reactionKey(picked);
    const m = this.message();
    const mine = m.reactions.find((r) => r.emoji === emoji && this.reacted(r));
    const path = `/channels/${m.channelId}/messages/${m.id}/reactions/${encodeURIComponent(emoji)}`;
    (mine ? this.api.delete(path) : this.api.put(path)).catch((e) => this.ui.error(e));
  }

  pickReaction(e: MouseEvent) {
    e.stopPropagation();
    this.ui.openPicker(e.currentTarget as Element, (emoji) => {
      const m = this.message();
      const has = m.reactions.find((r) => r.emoji === reactionKey(emoji) && this.reacted(r));
      if (!has) this.toggleReaction(emoji);
    });
  }

  profile(e: MouseEvent) {
    e.stopPropagation();
    this.ui.openProfile(this.message().authorId, this.message().guildId, e.currentTarget as Element);
  }

  authorMenu(e: MouseEvent) {
    const el = e.currentTarget as Element;
    this.ui.openMenu(
      e,
      userMenuItems(this.message().authorId, this.message().guildId, { store: this.store, ui: this.ui, api: this.api, nav: this.nav, voice: this.voice }, el),
    );
  }

  contentClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const spoiler = t.closest('.spoiler');
    if (spoiler) {
      spoiler.classList.add('revealed');
      return;
    }
    const user = t.closest<HTMLElement>('.mention[data-user]');
    if (user) {
      this.ui.openProfile(+user.dataset['user']!, this.message().guildId, user);
      return;
    }
    const ch = t.closest<HTMLElement>('.mention[data-channel]');
    if (ch) {
      const c = this.store.channels()[+ch.dataset['channel']!];
      if (c) this.nav.openChannel(c.guildId, c.id);
    }
  }

  jumpToRef() {
    const ref = this.message().reference;
    if (ref && !ref.deleted) this.nav.jump(this.message().guildId, this.message().channelId, ref.id);
  }

  reply() {
    this.chat.replyTo.set(this.message());
    this.chat.focusComposer();
  }

  startEdit() {
    this.chat.editingId.set(this.message().id);
  }

  cancelEdit() {
    this.chat.editingId.set(null);
    this.chat.focusComposer();
  }

  editKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.cancelEdit();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void this.saveEdit();
    }
  }

  async saveEdit() {
    const m = this.message();
    const ch = this.store.channels()[m.channelId];
    const content = toWire(this.editText.trim(), this.store, m.guildId, ch?.recipients);
    this.chat.editingId.set(null);
    this.chat.focusComposer();
    if (!content && !m.attachments.length) {
      await this.delete();
      return;
    }
    if (content === m.content) return;
    try {
      await this.api.patch(`/channels/${m.channelId}/messages/${m.id}`, { content });
    } catch (e) {
      this.ui.error(e);
    }
  }

  async delete(skipConfirm = false) {
    const m = this.message();
    if (!skipConfirm) {
      const ok = await confirmDialog(this.ui, {
        title: 'Excluir mensagem',
        body: 'Tem certeza de que deseja excluir esta mensagem?',
        confirmText: 'Excluir',
        danger: true,
      });
      if (!ok) return;
    }
    this.api.delete(`/channels/${m.channelId}/messages/${m.id}`).catch((e) => this.ui.error(e));
  }

  discard() {
    const m = this.message();
    if (m.nonce) this.store.patchPending(m.channelId, m.nonce, () => null);
  }

  menu(e: MouseEvent) {
    const m = this.message();
    if (m.pending) return;
    const canManage = m.guildId == null || this.store.isAdmin(m.guildId);
    const items: MenuItem[] = [
      {
        label: 'Adicionar reação',
        submenu: [
          ...this.prefs
            .data()
            .recentEmojis.slice(0, 6)
            .map((emoji) => ({ label: emojiLabel(emoji), action: () => this.toggleReaction(emoji) })),
          { separator: true },
          { label: 'Ver mais', action: () => this.ui.picker.set({ x: e.x, y: e.y, onPick: (emoji) => this.toggleReaction(emoji) }) },
        ],
      },
    ];
    if (m.type === 'default' && this.isMine()) items.push({ label: 'Editar mensagem', icon: 'edit', action: () => this.startEdit() });
    if (m.type === 'default') items.push({ label: 'Responder', icon: 'reply', action: () => this.reply() });
    if (m.type === 'default' && canManage) {
      items.push({
        label: m.pinned ? 'Desafixar mensagem' : 'Fixar mensagem',
        icon: 'pin',
        action: () => {
          const path = `/channels/${m.channelId}/pins/${m.id}`;
          (m.pinned ? this.api.delete(path) : this.api.put(path)).catch((err) => this.ui.error(err));
        },
      });
    }
    if (m.content) items.push({ label: 'Copiar texto', icon: 'copy', action: () => void copyText(toEditable(m.content, this.store)) });
    items.push({ label: 'Copiar ID da mensagem', icon: 'copy', action: () => void copyText(String(m.id)) });
    if (this.isMine() || (m.guildId != null && this.store.isAdmin(m.guildId))) {
      items.push({ separator: true }, { label: 'Excluir mensagem', icon: 'trash', danger: true, action: () => void this.delete(e.shiftKey) });
    }
    // Phones have no hover toolbar: the menu starts with the quick reactions, like Discord's app.
    if (this.ui.mobile()) {
      const recent = this.prefs.data().recentEmojis.slice(0, 6);
      if (recent.length) {
        items.unshift(
          { row: recent.map((emoji) => ({ label: emojiLabel(emoji), image: this.emojiUrl(emoji), action: () => this.toggleReaction(emoji) })) },
          { separator: true },
        );
      }
    }
    this.ui.openMenu(e, items);
  }
}
