import { Hub } from './hub';

export { Hub };

export interface Env {
  HUB: DurableObjectNamespace<Hub>;
  ASSETS: Fetcher;
  // Optional TURN relay, for calls behind CGNAT / strict firewalls. Either a Cloudflare Realtime TURN key...
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
  // ...or any TURN provider (comma-separated turn:/turns: URLs).
  TURN_URLS?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
}

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
