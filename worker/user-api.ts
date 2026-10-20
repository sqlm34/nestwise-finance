import { connectAuth, type AuthService, type AuthConfig } from './auth';
import { database } from './database';
import { limitedText } from './security';

export type UserEnv = {
  ENVIRONMENT: string; AUTH_ENABLED?: string; AUTH_DATABASE_URL?: string;
  AUTH_SECRET?: string; AUTH_BASE_URL?: string; AUTH_WEB_ORIGIN?: string;
  NESTWISE_DATABASE_URL?: string;
};
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
export function authConfiguration(env: UserEnv): AuthConfig | null {
  if (!['development','staging'].includes(env.ENVIRONMENT) || env.AUTH_ENABLED !== 'true'
    || !env.AUTH_DATABASE_URL || !env.NESTWISE_DATABASE_URL || !env.AUTH_SECRET || env.AUTH_SECRET.length < 32) return null;
  try {
    const base = new URL(env.AUTH_BASE_URL!);
    const local = env.ENVIRONMENT === 'development' && ['localhost','127.0.0.1'].includes(base.hostname);
    if (base.origin !== env.AUTH_BASE_URL || (!local && base.protocol !== 'https:')) return null;
    const origins = [base.origin, `nestwise-${env.ENVIRONMENT}://`];
    if (env.AUTH_WEB_ORIGIN) {
      const web = new URL(env.AUTH_WEB_ORIGIN);
      if (web.origin !== env.AUTH_WEB_ORIGIN || (!local && web.protocol !== 'https:')) return null;
      origins.push(web.origin);
    }
    return { baseURL: base.origin, secret: env.AUTH_SECRET, origins, development: local };
  } catch { return null; }
}
export async function userApi(request: Request, env: UserEnv,
  connect: (config: AuthConfig, url: string) => Promise<AuthService> = connectAuth,
  ledger = database): Promise<Response> {
  const config = authConfiguration(env);
  if (!config) return response({ error: 'not_found' }, 404);
  const url = new URL(request.url), origin = request.headers.get('origin');
  const webOrigin = origin && config.origins.includes(origin) && /^https?:\/\//.test(origin) ? origin : null;
  if (origin && !config.origins.includes(origin)) return response({ error: 'forbidden_origin' }, 403);
  const finish = (result: Response) => {
    const output = new Response(result.body, result);
    output.headers.set('Cache-Control','no-store');
    output.headers.set('X-Content-Type-Options','nosniff');
    if (webOrigin) {
      output.headers.set('Access-Control-Allow-Origin',webOrigin);
      output.headers.set('Access-Control-Allow-Credentials','true');
      output.headers.set('Vary','Origin');
    }
    return output;
  };
  if (request.method === 'OPTIONS') {
    if (!webOrigin) return response({error:'forbidden_origin'},403);
    const preflight=finish(new Response(null,{status:204}));
    preflight.headers.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    preflight.headers.set('Access-Control-Allow-Headers','Content-Type, Expo-Origin');
    return preflight;
  }
  const authPaths = new Map([['/api/auth/sign-in/email','POST'],['/api/auth/sign-out','POST'],['/api/auth/get-session','GET']]);
  const journalMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/journal$/i.exec(url.pathname);
  if (url.search || !(authPaths.get(url.pathname) === request.method ||
    request.method === 'GET' && (url.pathname === '/v1/session' || journalMatch))) return finish(response({error:'not_found'},404));
  // Cap credential bodies before the auth library parses JSON.
  let safeRequest=request;
  if (request.method==='POST') {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return finish(response({error:'invalid_body'},415));
    let raw: string;
    try {raw=await limitedText(request); if(new TextEncoder().encode(raw).length>4096) throw new Error();}
    catch {return finish(response({error:'invalid_body'},413));}
    safeRequest=new Request(request.url,{method:request.method,headers:request.headers,body:raw});
  }
  let service: AuthService | undefined;
  try {
    service=await connect(config,env.AUTH_DATABASE_URL!);
    if(authPaths.has(url.pathname)) return finish(await service.auth.handler(safeRequest));
    const session=await service.auth.api.getSession({headers:request.headers});
    if(!session) return finish(response({error:'unauthorized'},401));
    const db=ledger(env.NESTWISE_DATABASE_URL!);
    const subject=`better-auth:${session.user.id}`;
    if(journalMatch) return finish(response({entries:await db.userJournal(subject,journalMatch[1],journalMatch[2]),limit:100}));
    return finish(response({user:{id:session.user.id,name:session.user.name,email:session.user.email},
      workspaces:await db.userAccess(subject)}));
  } catch(error) {
    if(error instanceof Error && error.message==='forbidden') return finish(response({error:'not_found'},404));
    return finish(response({error:'temporarily_unavailable'},503));
  } finally { if(service) await service.close().catch(() => {}); }
}
