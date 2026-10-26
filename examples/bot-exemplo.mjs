// Exemplo de bot personalizado para o Resenha (Node.js 22 ou mais novo, sem dependências).
//
// 1. Em Configurações do servidor → Bots, clique em "Criar bot" e copie o token.
// 2. Rode:  RESENHA_TOKEN=rb.xxxxx node examples/bot-exemplo.mjs
//    (no PowerShell: $env:RESENHA_TOKEN='rb.xxxxx'; node examples/bot-exemplo.mjs)
//
// O bot responde a: !ping, !dado, !hora e !ajuda.

const BASE = process.env.RESENHA_URL ?? 'https://resenha.yannzinfelipe.workers.dev';
const TOKEN = process.env.RESENHA_TOKEN;
if (!TOKEN) {
  console.error('Defina RESENHA_TOKEN com o token do bot.');
  process.exit(1);
}
const headers = { authorization: `Bot ${TOKEN}`, 'content-type': 'application/json' };

/** Chama a API REST do Resenha como o bot. */
async function api(method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? ''}`);
  return data;
}

const send = (channelId, content, replyTo) => api('POST', `/channels/${channelId}/messages`, { content, replyTo });

const commands = {
  ping: (m) => send(m.channelId, 'pong! 🏓', m.id),
  dado: (m) => send(m.channelId, `🎲 Deu **${1 + Math.floor(Math.random() * 6)}**`, m.id),
  hora: (m) => send(m.channelId, `🕒 Agora são ${new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, m.id),
  ajuda: (m) => send(m.channelId, 'Comandos: `!ping`, `!dado`, `!hora`, `!ajuda`', m.id),
};

let me = null;
let retries = 0;

function connect() {
  // O gateway manda tudo que acontece nos servidores do bot: mensagens, membros, reações...
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/gateway`, { headers });
  let heartbeat;

  ws.onopen = () => {
    retries = 0;
    heartbeat = setInterval(() => ws.send('ping'), 30_000);
  };

  ws.onmessage = async (e) => {
    if (e.data === 'pong') return;
    const msg = JSON.parse(e.data);
    if (msg.op === 'ready') {
      me = msg.d.user;
      console.log(`Conectado como ${me.displayName} em ${msg.d.guilds.length} servidor(es).`);
      return;
    }
    if (msg.op !== 'event' || msg.t !== 'MESSAGE_CREATE') return;
    const m = msg.d;
    if (m.authorId === me?.id || m.author?.bot) return; // ignora a si mesmo e outros bots
    const cmd = m.content.match(/^!(\w+)/)?.[1]?.toLowerCase();
    if (cmd && commands[cmd]) {
      try {
        await commands[cmd](m);
      } catch (err) {
        console.error(err.message);
      }
    }
  };

  ws.onclose = (e) => {
    clearInterval(heartbeat);
    if (e.code === 4001) {
      console.error('O token foi trocado. Gere um novo nas configurações do servidor.');
      process.exit(1);
    }
    const delay = Math.min(30_000, 1000 * 2 ** retries++);
    console.log(`Desconectado. Tentando de novo em ${delay / 1000}s...`);
    setTimeout(connect, delay);
  };
}

connect();
