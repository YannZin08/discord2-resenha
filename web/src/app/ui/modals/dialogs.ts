import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Ui } from '../../core/ui';
import { Autofocus, Icon } from '../shared';

@Component({
  selector: 'app-confirm',
  imports: [Icon],
  template: `
    <div class="modal-backdrop" (click)="answer(false)"></div>
    <div class="modal small" role="dialog">
      <button class="modal-x" (click)="answer(false)"><app-icon name="close" /></button>
      <div class="modal-body">
        <h2>{{ title() }}</h2>
        <p class="modal-text">{{ body() }}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-link" (click)="answer(false)">Cancelar</button>
        <button class="btn" [class.btn-danger]="danger()" [class.btn-brand]="!danger()" (click)="answer(true)">{{ confirmText() }}</button>
      </div>
    </div>
  `,
})
export class Confirm {
  private ui = inject(Ui);
  readonly title = input('Tem certeza?');
  readonly body = input('');
  readonly confirmText = input('Confirmar');
  readonly danger = input(false);
  readonly resolve = input<(ok: boolean) => void>(() => undefined);
  answer(ok: boolean) {
    this.ui.close();
    this.resolve()(ok);
  }
}

export function confirmDialog(ui: Ui, opts: { title: string; body: string; confirmText?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => ui.open(Confirm, { ...opts, resolve }));
}

@Component({
  selector: 'app-prompt',
  imports: [FormsModule, Icon, Autofocus],
  template: `
    <div class="modal-backdrop" (click)="ui.close()"></div>
    <form class="modal small" (ngSubmit)="submit()">
      <button type="button" class="modal-x" (click)="ui.close()"><app-icon name="close" /></button>
      <div class="modal-body">
        <h2>{{ title() }}</h2>
        @if (body()) {
          <p class="modal-text">{{ body() }}</p>
        }
        <label class="field-label" [class.error]="error()">
          {{ label() }}
          @if (error()) {
            <span class="field-error"> - {{ error() }}</span>
          }
        </label>
        <input class="input" name="value" [(ngModel)]="value" [placeholder]="placeholder()" [attr.maxlength]="maxLength()" appAutofocus />
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-link" (click)="ui.close()">Cancelar</button>
        <button type="submit" class="btn btn-brand" [disabled]="busy()">{{ confirmText() }}</button>
      </div>
    </form>
  `,
})
export class Prompt {
  readonly ui = inject(Ui);
  readonly title = input('');
  readonly body = input('');
  readonly label = input('');
  readonly placeholder = input('');
  readonly initial = input('');
  readonly maxLength = input(100);
  readonly confirmText = input('Salvar');
  readonly onSubmit = input<(v: string) => Promise<unknown>>(async () => undefined);
  readonly busy = signal(false);
  readonly error = signal('');
  value = '';

  ngOnInit() {
    this.value = this.initial();
  }

  async submit() {
    this.busy.set(true);
    try {
      await this.onSubmit()(this.value.trim());
      this.ui.close();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}

export function promptDialog(
  ui: Ui,
  opts: { title: string; label: string; body?: string; initial?: string; placeholder?: string; confirmText?: string; maxLength?: number },
  onSubmit: (v: string) => Promise<unknown>,
) {
  ui.open(Prompt, { ...opts, onSubmit });
}
