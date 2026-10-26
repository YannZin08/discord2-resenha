// Fills the LOCAL dev server (npm run dev) with demo data: two test accounts that are
// friends, a server with a few messages and a DM. Run: node scripts/seed-dev.mjs
// Never point this at production.
const BASE = process.argv[2] ?? 'http://127.0.0.1:8787';
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(BASE)) throw new Error('seed-dev só roda contra o servidor local');

export const TEST_ACCOUNTS = [
  { username: 'ana.teste', displayName: 'Ana', password: 'teste123' },
  { username: 'bia.teste', displayName: 'Bia', password: 'teste123' },
];

function client() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await fetch(BASE + '/api' + path, {
      method,
      headers: { 'content-type': 'application/json', cookie, origin: BASE },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(data?.error ?? res.status), { status: res.status });
    return data;
  };
}

async function signIn(api, acc) {
  try {
    return (await api('POST', '/auth/register', acc)).user;
  } catch (e) {
    if (e.status !== 409) throw e;
    return (await api('POST', '/auth/login', acc)).user;
  }
}

const [a, b] = [client(), client()];
const ana = await signIn(a, TEST_ACCOUNTS[0]);
const bia = await signIn(b, TEST_ACCOUNTS[1]);

await a('POST', '/relationships', { username: bia.username }).catch(() => undefined);
await b('PUT', `/relationships/${ana.id}`, { type: 'friend' }).catch(() => undefined);

const g = await a('POST', '/guilds', { name: 'Servidor de Testes' });
const inv = await a('POST', `/guilds/${g.id}/invites`);
await b('POST', `/invites/${inv.code}`);
const ch = g.systemChannelId;
await a('POST', `/channels/${ch}/messages`, { content: 'Fala, pessoal! 👋 Bem-vindos ao **Resenha**.' });
await b('POST', `/channels/${ch}/messages`, { content: `Opa <@${ana.id}>! Ficou muito parecido com o Discord 😂` });
await a('POST', `/channels/${ch}/messages`, { content: 'Dá pra usar `código`, ||spoiler||, > citações\ne links: https://github.com' });
const dm = await b('POST', '/dms', { recipients: [ana.id] });
await b('POST', `/channels/${dm.id}/messages`, { content: 'Oi Ana, testando a mensagem direta!' });

console.log(`Pronto. Contas de teste: ${TEST_ACCOUNTS.map((x) => x.username).join(', ')} (senha em scripts/seed-dev.mjs)`);
