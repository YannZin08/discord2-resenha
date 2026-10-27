# Resenha

App de comunicação no estilo Discord: servidores, canais de texto e voz, mensagens diretas, amigos, chamadas de voz e vídeo, compartilhamento de tela.

Roda inteiro na Cloudflare (mesma stack do AcessosVirtual):

- **Worker** (`worker/`): API e WebSocket.
- **Durable Object `Hub`** (`worker/hub.ts`): guarda tudo num SQLite próprio (inclusive anexos, avatares e ícones, em pedaços de 1 MB) e mantém as conexões em tempo real. Um único objeto atende o app todo, o que é simples e consistente para uma equipe ou grupo de amigos. Não usa R2, então não precisa de cartão na Cloudflare.
- **Web** (`web/`): Angular 21 (signals, zoneless), servido como assets estáticos pelo Worker.

## O que tem

- Contas (usuário + senha), perfil com avatar e banner (imagem ou GIF animado, até 10 MB cada; sem imagem, o banner usa a cor escolhida), "sobre mim", status (disponível, ausente, não perturbar, invisível) e status personalizado.
- Servidores com ícone, convites por link, categorias, canais de texto e voz, cargos com cor (com opção de exibir separadamente e de administrador), apelidos, expulsar, banir, transferir posse.
- Mensagens com markdown do Discord (`**negrito**`, `*itálico*`, `__sublinhado__`, `~~riscado~~`, `||spoiler||`, `` `código` ``, blocos de código, `> citação`, títulos, listas), menções `@usuário`, `@everyone`, `#canal`, emojis (`:joy:`), respostas, edição (seta ↑ edita a última), exclusão, reações, mensagens fixadas, busca, prévia de links e vídeos do YouTube, anexos de até 25 MB (arrastar e soltar ou colar imagem).
- Indicador de "digitando", não lidas, contador de menções, notificações na área de trabalho e sons.
- Amigos (pedidos, aceitar, bloquear), mensagens diretas e grupos de até 10 pessoas.
- Voz e vídeo por WebRTC: canais de voz, chamadas na DM com toque, câmera, compartilhamento de tela com áudio, indicador de quem está falando, volume por pessoa, escolha de microfone, alto-falante e câmera.
- Sons de chamada como os do Discord: alguém entrou ou saiu da call, começou ou parou de transmitir, entrou ou saiu da sua transmissão, e silenciar/ensurdecer (dá para desligar os sons nas configurações).
- Configurações de voz como as do Discord: volume de entrada e saída, teste de microfone (reproduz sua voz), modo **Detecção de voz** (sensibilidade automática ou manual com medidor) ou **Pressione para falar** (atalho e atraso para soltar), **supressão de ruído** Avançada (IA, RNNoise), Padrão (do navegador) ou Nenhuma, cancelamento de eco e controle automático de ganho.
- Transmissão de tela na qualidade máxima por padrão: resolução da tela até 4K, 60 FPS, sem reduzir a resolução, bitrate alto (~25 Mbps em 4K) e codec com aceleração de hardware quando houver. Dá para mudar em "Transmitir tela" ou em Configurações → Transmissão, inclusive durante a transmissão. Quem assiste vê a resolução recebida (ex.: "AO VIVO 4K"). Como no Discord, a transmissão só chega para quem clica em **Assistir transmissão** (no quadro dela, no "AO VIVO" da lista do canal ou no clique direito na pessoa) e para com **Sair da transmissão**; o quadro mostra quantas pessoas estão assistindo.
- Temas: Claro, Cinza, Escuro, Meia-noite e temas coloridos (Aurora, Pôr do sol, Floresta, Oceano, Lua carmesim, Neon, Algodão-doce), além do tamanho da fonte do chat. Fica em Configurações → Aparência, salvo por dispositivo.
- Ctrl+K para pular para qualquer canal ou conversa; menus de clique direito em quase tudo; layout para celular; instalável como app (PWA).

## Bots

Em Configurações do servidor → **Bots**:

- **Música** (embutido): entre num canal de voz e digite `/tocar <link do YouTube ou nome da música>`. Links de playlist ou álbum (YouTube ou YouTube Music, públicas ou não listadas) põem até 500 músicas na fila; se o link aponta para uma música dentro da playlist, a fila começa nela. Link de música com mix automático (`list=RD…`) ou de uma lista privada (como as "Músicas curtidas") toca só a música. Também tem `/pular`, `/pausar`, `/continuar`, `/fila`, `/tocando`, `/parar` e `/ajuda` (com `/` ou `!`). Quem está no canal vê um mini-player com a música sincronizada pelo relógio do servidor, usando o player oficial do YouTube; o bot sai sozinho quando todo mundo sai do canal, quando a fila acaba, quando a música fica pausada por 5 minutos ou quando ela não começa a tocar para ninguém da call.
- **Bots personalizados**: "Criar bot" gera um token. Seu programa usa o cabeçalho `Authorization: Bot <token>` na API REST (`/api/...`, as mesmas rotas do app) e no gateway (`wss://.../api/gateway`, eventos como `MESSAGE_CREATE`). Exemplo pronto, sem dependências:

```bash
RESENHA_TOKEN=rb.xxxxx node examples/bot-exemplo.mjs
```

Bots do Discord não funcionam aqui: eles usam a API do Discord.

## Rodar localmente

```bash
npm install
```

```bash
npm run build:web
```

```bash
npm run dev
```

Abra http://127.0.0.1:8787. Os dados locais ficam em `.wrangler/state`.

Para criar duas contas de teste já amigas, com um servidor de exemplo:

```bash
node scripts/seed-dev.mjs
```

Depois de mudar o front, rode `npm run build:web` de novo: o `wrangler dev` pega os arquivos novos sozinho.

## Publicar na Cloudflare

O `wrangler.toml` está fixado na conta `Yannzinfelipe@gmail.com's Account` (`account_id`). Com o wrangler logado nessa conta:

```bash
npm run deploy
```

O app fica em `https://resenha.<sua-conta>.workers.dev`. Dá para apontar um domínio próprio pelo painel da Cloudflare.

### Voz em redes difíceis (TURN)

As chamadas são ponto a ponto. Em muitas redes (CGNAT de provedor, firewall de empresa, Wi-Fi com isolamento) a conexão direta não passa: todos entram na call, mas ninguém se ouve e a tela compartilhada fica preta. Clique em "Voz conectada" no painel da chamada para ver "Detalhes da conexão" (direta, retransmitida ou falhando).

Para resolver, configure um retransmissor TURN. Com a TURN da Cloudflare (painel → Realtime → TURN Server → criar chave), salve as credenciais como segredos:

```bash
npx wrangler secret put TURN_KEY_ID
```

```bash
npx wrangler secret put TURN_KEY_API_TOKEN
```

Ou, com outro provedor de TURN, use `TURN_URLS` (URLs `turn:`/`turns:` separadas por vírgula), `TURN_USERNAME` e `TURN_CREDENTIAL`.

## Limites conhecidos

- A voz é em malha (cada pessoa conecta com cada pessoa): fica boa até umas 8 pessoas por canal de voz. Na transmissão, quem transmite envia uma cópia para cada pessoa que clicou em assistir (quem não assiste não gasta nada): 4K a 60 FPS pede ~25 Mbps de upload por espectador, e o navegador reduz automaticamente se a internet não aguentar.
- Os arquivos ficam no SQLite do Durable Object: no plano gratuito são uns 5 GB no total (somando mensagens e arquivos). Se crescer, dá para mover os arquivos para o R2.
- Permissões simplificadas: todo membro vê todos os canais; quem tem cargo de administrador (ou o dono) gerencia o servidor.
- Não há app nativo para celular: no celular, use pelo navegador ou "Adicionar à tela inicial".
