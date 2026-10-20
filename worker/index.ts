import { validateEvent, uuid } from './contract';
import { authenticateEvent, limitedText, sha256 } from './security';
import { database, type Database } from './database';
import { userApi, type UserEnv } from './user-api';
export type Env = UserEnv & {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  FINANCIAL_INGESTION_ENABLED?: string;
  NESTWISE_DATABASE_URL?: string;
  CRM_SERVICE_KEYS?: string;
};
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const enabled = (env: Env) => env.ENVIRONMENT !== 'production' && env.FINANCIAL_INGESTION_ENABLED === 'true'
  && !!env.NESTWISE_DATABASE_URL && !!env.CRM_SERVICE_KEYS;
export function createWorker(connect: (url: string) => Database = database) {
  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ service: 'nestwise', environment: env.ENVIRONMENT, status: 'ok', financialIngestion: enabled(env) });
      }
      if (url.pathname.startsWith('/api/auth/') || url.pathname === '/v1/session' || url.pathname.startsWith('/v1/user/') || url.pathname.startsWith('/v1/invitations/')) {
        return userApi(request, env);
      }
      if (!enabled(env)) return json({ error: 'not_found' }, 404);
      if (url.pathname === '/v1/crm/events' && request.method === 'POST' && !url.search) {
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return json({ error: 'unsupported_media_type' }, 415);
        let raw: string;
        try { raw = await limitedText(request); }
        catch (error) { return json({ error: error instanceof Error && error.message === 'body_too_large' ? 'body_too_large' : 'invalid_body' }, error instanceof Error && error.message === 'body_too_large' ? 413 : 400); }
        let auth;
        try { auth = await authenticateEvent(request, raw, env.CRM_SERVICE_KEYS!); }
        catch { return json({ error: 'unauthorized' }, 401); }
        try { validateEvent(JSON.parse(raw)); }
        catch { return json({ error: 'invalid_event' }, 400); }
        try {
          const result = await connect(env.NESTWISE_DATABASE_URL!).accept(auth.connection, auth.nonce, auth.timestamp, raw);
          // ACK is emitted only after the database commits, including persisted needs_review events.
          return json(result, 202);
        } catch (error) {
          const code = error instanceof Error ? error.message : '';
          if (['replayed_request', 'event_payload_conflict'].includes(code)
            || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'))
            return json({ error: 'event_conflict' }, 409);
          if (['connection_disabled', 'expired_request'].includes(code)) return json({ error: 'unauthorized' }, 401);
          return json({ error: 'temporarily_unavailable' }, 503);
        }
      }
      const match = /^\/v1\/workspaces\/([^/]+)\/accounts\/([^/]+)\/journal$/.exec(url.pathname);
      if (request.method === 'GET' && match && !url.search) {
        if (!uuid.test(match[1]) || !uuid.test(match[2])) return json({ error: 'not_found' }, 404);
        const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!token) return json({ error: 'unauthorized' }, 401);
        try {
          return json({ entries: await connect(env.NESTWISE_DATABASE_URL!).journal(await sha256(token), match[1], match[2]), limit: 100 });
        } catch (error) {
          const message = error instanceof Error ? error.message : '';
          if (message === 'unauthorized') return json({ error: 'unauthorized' }, 401);
          if (message === 'forbidden') return json({ error: 'not_found' }, 404);
          return json({ error: 'temporarily_unavailable' }, 503);
        }
      }
      return json({ error: 'not_found' }, 404);
    },
    async scheduled(_event: unknown, env: Env): Promise<void> {
      if (enabled(env)) await connect(env.NESTWISE_DATABASE_URL!).processPending();
    },
  };
}
export default {
  ...createWorker(),
};
