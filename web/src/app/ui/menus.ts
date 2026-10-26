import type { Api } from '../core/api';
import type { Nav } from '../core/nav';
import type { Store } from '../core/store';
import type { Channel, Guild } from '../core/types';
import type { MenuItem, Ui } from '../core/ui';
import type { Voice } from '../core/voice';
import { copyText } from '../core/util';
import { ChannelSettings, CreateChannel } from './modals/channel-modals';
import { confirmDialog, promptDialog } from './modals/dialogs';
import { GuildSettings } from './modals/guild-settings';
import { InviteModal } from './modals/invite';

export function guildMenuItems(g: Guild, store: Store, ui: Ui, api: Api, nav: Nav): MenuItem[] {
  const admin = store.isAdmin(g.id);
  const owner = store.isOwner(g.id);
  const items: MenuItem[] = [
    { label: 'Marcar como lida', disabled: !store.guildUnread(g.id), action: () => void api.post(`/guilds/${g.id}/ack`).catch((e) => ui.error(e)) },
    { separator: true },
    { label: 'Convidar pessoas', icon: 'personAdd', action: () => ui.open(InviteModal, { guildId: g.id }) },
  ];
  if (admin) {
    items.push(
      { label: 'Configurações do servidor', icon: 'gear', action: () => ui.open(GuildSettings, { guildId: g.id }) },
      { label: 'Criar canal', icon: 'addCircle', action: () => ui.open(CreateChannel, { guildId: g.id }) },
      { label: 'Criar categoria', icon: 'addCircle', action: () => ui.open(CreateChannel, { guildId: g.id, category: true }) },
    );
  }
  items.push({
    label: 'Alterar apelido',
    icon: 'edit',
    action: () =>
      promptDialog(
        ui,
        { title: 'Alterar apelido', label: 'Apelido', initial: store.member(g.id, store.me()!.id)?.nick ?? '', maxLength: 32 },
        (nick) => api.patch(`/guilds/${g.id}/members/@me`, { nick: nick || null }),
      ),
  });
  if (!owner) {
    items.push(
      { separator: true },
      {
        label: 'Sair do servidor',
        danger: true,
        action: async () => {
          const ok = await confirmDialog(ui, {
            title: `Sair de '${g.name}'`,
            body: `Tem certeza de que deseja sair de ${g.name}? Você só poderá voltar se for convidado novamente.`,
            confirmText: 'Sair do servidor',
            danger: true,
          });
          if (!ok) return;
          await api.delete(`/guilds/${g.id}/members/@me`).catch((e) => ui.error(e));
          if (nav.guildId() === g.id) nav.home();
        },
      },
    );
  }
  return items;
}

export function channelMenuItems(c: Channel, store: Store, ui: Ui, api: Api): MenuItem[] {
  const admin = store.isAdmin(c.guildId);
  const items: MenuItem[] = [];
  if (c.type !== 'category' && c.type !== 'voice') {
    items.push({
      label: 'Marcar como lida',
      disabled: !store.isUnread(c),
      action: () => void api.post(`/channels/${c.id}/ack`, {}).catch((e) => ui.error(e)),
    });
  }
  if (c.guildId != null && c.type !== 'category') {
    items.push({ label: 'Convidar pessoas', icon: 'personAdd', action: () => ui.open(InviteModal, { guildId: c.guildId }) });
  }
  if (admin) {
    items.push({ separator: true });
    if (c.type === 'category') {
      items.push({ label: 'Criar canal', icon: 'addCircle', action: () => ui.open(CreateChannel, { guildId: c.guildId, parentId: c.id }) });
    }
    items.push(
      { label: c.type === 'category' ? 'Editar categoria' : 'Editar canal', icon: 'gear', action: () => ui.open(ChannelSettings, { channelId: c.id }) },
      {
        label: c.type === 'category' ? 'Excluir categoria' : 'Excluir canal',
        danger: true,
        action: async () => {
          const ok = await confirmDialog(ui, {
            title: c.type === 'category' ? 'Excluir categoria' : 'Excluir canal',
            body: `Tem certeza de que deseja excluir ${c.type === 'text' ? '#' : ''}${c.name}? Isso não pode ser desfeito.`,
            confirmText: 'Excluir',
            danger: true,
          });
          if (ok) await api.delete(`/channels/${c.id}`).catch((e) => ui.error(e));
        },
      },
    );
  }
  items.push({ separator: true }, { label: 'Copiar ID do canal', icon: 'copy', action: () => void copyText(String(c.id)) });
  return items;
}

export function userMenuItems(
  userId: number,
  guildId: number | null,
  deps: { store: Store; ui: Ui; api: Api; nav: Nav; voice: Voice },
  anchor?: Element,
): MenuItem[] {
  const { store, ui, api, nav, voice } = deps;
  const me = store.me()!.id;
  const user = store.users()[userId];
  const rel = store.relationships()[userId];
  const items: MenuItem[] = [
    { label: 'Perfil', action: () => anchor && ui.openProfile(userId, guildId, anchor) },
  ];
  if (userId !== me && user?.bot) {
    // Bots: only the call volume (e.g. turning the music bot down) and the profile.
    const inMyCall = Object.values(store.voiceStates()).some((v) => v.userId === userId && v.channelId != null && v.channelId === voice.channelId());
    if (inMyCall) {
      items.push({
        label: 'Volume do usuário',
        slider: { value: voice.userVolume(userId), min: 0, max: 100, format: (v) => `${v}%`, onInput: (v) => voice.setUserVolume(userId, v) },
      });
    }
  } else if (userId !== me) {
    const openDm = async () => {
      const ch = await api.post<Channel>('/dms', { recipients: [userId] });
      nav.openChannel(null, ch.id);
      return ch;
    };
    items.push(
      { label: 'Mensagem', action: () => void openDm().catch((e) => ui.error(e)) },
      {
        label: 'Ligar',
        action: () =>
          void openDm()
            .then((ch) => voice.join(ch.id, null))
            .catch((e) => ui.error(e)),
      },
    );
    const inMyCall = Object.values(store.voiceStates()).some((v) => v.userId === userId && v.channelId != null && v.channelId === voice.channelId());
    if (inMyCall) {
      items.push({
        label: 'Volume do usuário',
        slider: { value: voice.userVolume(userId), min: 0, max: 100, format: (v) => `${v}%`, onInput: (v) => voice.setUserVolume(userId, v) },
      });
    }
    items.push({ separator: true });
    if (rel === 'friend') {
      items.push({
        label: 'Remover amizade',
        action: async () => {
          const ok = await confirmDialog(ui, {
            title: `Remover '${user?.displayName}'`,
            body: `Tem certeza de que deseja remover ${user?.displayName} dos seus amigos?`,
            confirmText: 'Remover amizade',
            danger: true,
          });
          if (ok) await api.delete(`/relationships/${userId}`).catch((e) => ui.error(e));
        },
      });
    } else if (rel === 'incoming') {
      items.push({ label: 'Aceitar pedido de amizade', action: () => void api.put(`/relationships/${userId}`, { type: 'friend' }).catch((e) => ui.error(e)) });
    } else if (rel !== 'outgoing' && rel !== 'blocked') {
      items.push({ label: 'Adicionar amigo', action: () => void api.post('/relationships', { username: user?.username }).catch((e) => ui.error(e)) });
    }
    items.push(
      rel === 'blocked'
        ? { label: 'Desbloquear', action: () => void api.delete(`/relationships/${userId}`).catch((e) => ui.error(e)) }
        : {
            label: 'Bloquear',
            danger: true,
            action: async () => {
              const ok = await confirmDialog(ui, {
                title: `Bloquear ${user?.displayName}?`,
                body: 'Essa pessoa não poderá mais te mandar mensagens diretas e a amizade será desfeita.',
                confirmText: 'Bloquear',
                danger: true,
              });
              if (ok) await api.put(`/relationships/${userId}`, { type: 'blocked' }).catch((e) => ui.error(e));
            },
          },
    );
  }

  if (guildId != null && store.member(guildId, userId)) {
    const admin = store.isAdmin(guildId);
    const member = store.member(guildId, userId)!;
    const roles = store.roles()[guildId] ?? [];
    if (admin || userId === me) {
      items.push(
        { separator: true },
        {
          label: 'Alterar apelido',
          action: () =>
            promptDialog(ui, { title: 'Alterar apelido', label: 'Apelido', initial: member.nick ?? '', maxLength: 32 }, (nick) =>
              api.patch(`/guilds/${guildId}/members/${userId}`, { nick: nick || null }),
            ),
        },
      );
    }
    if (admin && roles.length) {
      items.push({
        label: 'Cargos',
        submenu: roles.map((r) => ({
          label: r.name,
          color: r.color || '#99aab5',
          checked: member.roles.includes(r.id),
          action: () => {
            const cur = store.member(guildId, userId)?.roles ?? [];
            const next = cur.includes(r.id) ? cur.filter((x) => x !== r.id) : [...cur, r.id];
            api.patch(`/guilds/${guildId}/members/${userId}`, { roles: next }).catch((e) => ui.error(e));
          },
        })),
      });
    }
    const owner = store.isOwner(guildId);
    const targetIsOwner = store.isOwner(guildId, userId);
    if (admin && userId !== me && !targetIsOwner && (owner || !store.isAdmin(guildId, userId))) {
      const name = store.nameIn(guildId, userId);
      items.push(
        { separator: true },
        {
          label: `Expulsar ${name}`,
          danger: true,
          action: async () => {
            const ok = await confirmDialog(ui, { title: `Expulsar ${name}`, body: `${name} poderá voltar com um novo convite.`, confirmText: 'Expulsar', danger: true });
            if (ok) await api.delete(`/guilds/${guildId}/members/${userId}`).catch((e) => ui.error(e));
          },
        },
        {
          label: `Banir ${name}`,
          danger: true,
          action: async () => {
            const ok = await confirmDialog(ui, { title: `Banir ${name}`, body: `${name} sai do servidor e não poderá voltar.`, confirmText: 'Banir', danger: true });
            if (ok) await api.put(`/guilds/${guildId}/bans/${userId}`).catch((e) => ui.error(e));
          },
        },
      );
    }
    if (owner && userId !== me) {
      items.push({
        label: 'Transferir posse',
        danger: true,
        action: async () => {
          const ok = await confirmDialog(ui, {
            title: 'Transferir posse',
            body: `${store.nameIn(guildId, userId)} vai virar dono do servidor. Você deixa de ser o dono.`,
            confirmText: 'Transferir',
            danger: true,
          });
          if (ok) await api.patch(`/guilds/${guildId}`, { ownerId: userId }).catch((e) => ui.error(e));
        },
      });
    }
  }
  items.push(
    { separator: true },
    { label: 'Copiar nome de usuário', icon: 'copy', action: () => void copyText(user?.username ?? '') },
    { label: 'Copiar ID do usuário', icon: 'copy', action: () => void copyText(String(userId)) },
  );
  return items;
}
