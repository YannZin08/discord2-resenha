import { Injectable, signal } from '@angular/core';
import type { Message } from '../core/types';

/** Per-chat UI state shared by the message list and the composer. */
@Injectable()
export class ChatState {
  readonly replyTo = signal<Message | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly highlightId = signal<number | null>(null);
  readonly uploadProgress = signal<Record<string, number>>({});
  focusComposer: () => void = () => undefined;
  retry: (m: Message) => void = () => undefined;
}

/** Unsent text per channel survives switching channels, like Discord drafts. */
@Injectable({ providedIn: 'root' })
export class Drafts {
  private drafts = new Map<number, string>();
  get(channelId: number) {
    return this.drafts.get(channelId) ?? '';
  }
  set(channelId: number, text: string) {
    if (text) this.drafts.set(channelId, text);
    else this.drafts.delete(channelId);
  }
}
