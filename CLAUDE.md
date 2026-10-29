# Resenha — notas para o Claude

App de comunicação no estilo Discord (servidores, canais de texto/voz, DMs, amigos, chamadas, transmissão de tela, bots). Interface toda em pt-BR. O usuário conversa em português.

## Arquitetura

- `worker/index.ts` — Worker da Cloudflare: manda `/api/*` para o Durable Object e o resto para os assets do site.
- `worker/hub.ts` — Durable Object `Hub` (um só, `idFromName('main')`): SQLite com tudo (usuários, servidores, mensagens, **arquivos em pedaços de 1 MB**), REST, WebSocket com hibernação (`/api/gateway`), sinalização WebRTC e o bot de música.
- `worker/music.ts` — bot de música: comandos (`/tocar`, `/pular`, …), busca/oEmbed do YouTube.
- `worker/unfurl.ts` — prévia de links.
- `web/` — Angular 21, componentes standalone, zoneless, estado em signals. `core/` (store, gateway, voice, mic, prefs…) e `ui/` (componentes; modais em `ui/modals/`). Estilos globais em `web/src/styles.css` com temas por `[data-theme]`.
- Voz/vídeo: WebRTC em malha (`core/voice.ts`), microfone processado em `core/mic.ts` (RNNoise + portão em `web/public/voice-gate.js`).
- Bot de música: o YouTube toca escondido no navegador de cada pessoa (`ui/music-player.ts`), sincronizado pelo relógio do servidor; o bot aparece como "falando" e o volume é o "Volume do usuário" dele.
- Atividade ("Jogando X"): coluna `activity` em `users`, `PUT /api/users/@me/activity`. Manual fica até parar; a do detector expira em 2 min sem novo aviso. O detector do Windows é um `.cmd` gerado em `web/src/app/core/game-detector.ts` (Steam pelo registro + lista de processos), com chave própria (`Authorization: Activity <token>`) que só vale nessa rota.
- Temas coloridos: cores em `core/themes.ts` (degradê e janelas); o CSS só tem um bloco por tom (`[data-tone]`). Cor de destaque troca `--brand`.
- Emojis: todos liberados, sem "Nitro". Os Unicode vêm de `web/public/emoji.json` (gerado por `node scripts/build-emoji.mjs` a partir do `emojibase-data`, desenhados pelo Twemoji 17). Os personalizados ficam na tabela `emojis`: do servidor (`guild_id` = servidor, aba "Emojis" das configurações do servidor, só admins enviam) ou da pessoa (`guild_id` = 0 e `user_id` = dono, aba "Meus emojis" das configurações de usuário, `/api/users/@me/emojis`), sem limite de quantidade; a tela de envio é `ui/emoji-manager.ts`, vão nas mensagens como `<:nome:id>`/`<a:nome:id>` e nas reações como `nome:id`, e qualquer pessoa usa os de qualquer servidor seu em qualquer chat. Imagem em `GET /api/emojis/:id` (pública).
- Efeitos sonoros (soundboard): tabela `sounds`, mesmos escopos dos emojis (servidor: aba "Efeitos sonoros", só admins enviam; pessoais: "Meus sons", `/api/users/@me/sounds`), sem limite de quantidade, até 5 MB cada, com nome, emoji e volume. Tela de envio em `ui/sound-manager.ts`, painel em `ui/soundboard-panel.ts` (botão na chamada e no painel "Voz conectada"). Tocar é a op `sound` do gateway: o servidor manda `SOUNDBOARD_PLAY` para quem está no canal e cada navegador toca o arquivo (`GET /api/sounds/:id`) em `core/soundboard.ts`, sem passar pelo áudio da chamada; quem tocou aparece "falando". Respeita ensurdecer, volume do usuário 0 e "Volume dos efeitos sonoros" (Voz e vídeo).
- Celular (≤768px, `ui.mobile()`): canais e servidores numa gaveta à esquerda, lista de membros numa gaveta à direita (≤900px, `ui.narrow()`), deslizar o dedo abre/fecha (`shell.ts`). Toque longo vira `contextmenu` (`core/long-press.ts`), então todo menu de botão direito funciona no toque; menus, card de perfil, emojis e soundboard viram folha de baixo (CSS no fim do `styles.css`, bloco "phones"). Configurações mostram a lista de seções e depois a seção com "Voltar". A altura segue o teclado (`--app-height`).
- Bots personalizados: `Authorization: Bot <token>` na REST e no gateway. Exemplo em `examples/bot-exemplo.mjs`.

## Comandos

- `npm install` e `npm run build:web` (instala e compila o `web/`).
- `npm run dev` — servidor local em http://127.0.0.1:8787 (dados em `.wrangler/state`). Depois de mudar o front, `npm run build:web` de novo.
- `node scripts/seed-dev.mjs` — contas de teste locais (`ana.teste`, `bia.teste`) e um servidor de exemplo.
- `npm run typecheck` — TypeScript do worker. `npm run build` — typecheck + build do web.
- `npm run deploy` — publica. **Sempre peça confirmação ao usuário antes de publicar.**

## Publicação e contas

- Site: https://resenha.yannzinfelipe.workers.dev — conta Cloudflare "Yannzinfelipe@gmail.com's Account", fixada por `account_id` no `wrangler.toml`. O wrangler precisa estar logado nessa conta (`npx wrangler whoami`).
- GitHub: https://github.com/YannZin08/discord2-resenha (branch `master`).

## Decisões já tomadas

- **Sem R2**: o usuário não quer colocar cartão na Cloudflare; arquivos ficam no SQLite do Durable Object (~5 GB no plano grátis). Não reintroduzir serviços pagos sem perguntar.
- **TURN pendente**: chamadas entre redes diferentes podem falhar (ninguém se ouve, tela preta) sem um retransmissor. O servidor já aceita `TURN_KEY_ID`/`TURN_KEY_API_TOKEN` (Cloudflare) ou `TURN_URLS`/`TURN_USERNAME`/`TURN_CREDENTIAL` via `wrangler secret put`. "Detalhes da conexão" (clicar em "Voz conectada") mostra se a ligação está direta, retransmitida ou falhando.
- Bots do Discord não são compatíveis; o app tem sistema de bots próprio.
- Transmissão de tela começa na qualidade máxima (até 4K, 60 FPS).
- Configurações de voz imitam as do Discord (detecção de voz/pressione para falar, supressão de ruído, eco, ganho).

## Jeito de trabalhar

- Testar no navegador local com as contas de teste antes de publicar; para voz, simular microfone (o painel de teste bloqueia o real).
- O `ng build` não apaga a pasta de saída (`deleteOutputPath: false`) para o `wrangler dev` não perder os arquivos novos.
