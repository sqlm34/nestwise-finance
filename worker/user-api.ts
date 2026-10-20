import { connectAuth, type AuthService, type AuthConfig } from './auth';
import {documentApi,type DocumentEnv} from './documents';
import { database } from './database';
import { limitedText } from './security';
import { acceptInvitation, invitations } from './invitations';
import {parseHistoryParams} from '../src/domain/journal-history';
import {detailBefore} from '../src/domain/journal-detail';
import {parseEventParams} from '../src/domain/account-events';
import {parsePeriodParams} from '../src/domain/period-insights';
import {candidateParams} from '../src/domain/reconciliation';
import {parseSave,parseCancellation,savedCursor} from '../src/domain/saved-reconciliation';
import {parseManualOperation} from '../src/domain/manual-operation';
import {parseWorkspaceCommand} from '../src/domain/workspace-admin';
import {receiptApi,type ReceiptEnv} from './receipts';

export type UserEnv = DocumentEnv & ReceiptEnv & {
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
  ledger = database, invitationStore = invitations): Promise<Response> {
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
  const invitationRoute=url.pathname==='/v1/invitations/accept' && request.method==='POST';
  const receiptMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/receipts(?:\/([0-9a-f]{64})(?:\/(original|review|post|ocr))?)?$/i.exec(url.pathname);
  const receiptList=!!receiptMatch&&!receiptMatch[3]&&request.method==='GET';
  const receiptRoute=receiptList||!!receiptMatch&&!url.search&&(request.method==='GET'&&(!receiptMatch[4]||receiptMatch[4]==='original')||request.method==='POST'&&!!receiptMatch[4]);
  const receiptWrite=receiptRoute&&request.method==='POST';
  const receiptUpload=receiptWrite&&receiptMatch?.[4]==='original';
  const adminMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/administration$/i.exec(url.pathname);
  const adminRoute=!!adminMatch&&!url.search&&['GET','POST'].includes(request.method);
  const adminWrite=adminRoute&&request.method==='POST';
  const manualMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/operations$/i.exec(url.pathname);
  const manualWrite=!!manualMatch&&request.method==='POST'&&!url.search;
  const savedMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/reconciliations$/i.exec(url.pathname);
  const cancelMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/reconciliations\/([0-9a-f-]{36})\/cancel$/i.exec(url.pathname);
  const documentMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/documents(?:\/([0-9a-f]{64})(\/(?:verify|review|book))?)?$/i.exec(url.pathname);
  const documentRoute=!!documentMatch&&!url.search&&(request.method==='GET'&&documentMatch[4]!=='/book'||request.method==='POST'&&!!documentMatch[3]&&(!documentMatch[4]||documentMatch[4]==='/book'));
  const documentWrite=documentRoute&&request.method==='POST';
  const reconciliationWrite=request.method==='POST'&&(savedMatch||cancelMatch);
  const reconciliationMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/reconciliation-candidates$/i.exec(url.pathname);
  const insightsMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/insights$/i.exec(url.pathname);
  const eventsMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/events$/i.exec(url.pathname);
  const eventDetailMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/events\/([0-9a-f-]{36})$/i.exec(url.pathname);
  const journalMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/journal$/i.exec(url.pathname);
  const detailMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/journal\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if ((url.search&&(reconciliationWrite||!receiptList&&!journalMatch&&!detailMatch&&!eventsMatch&&!eventDetailMatch&&!insightsMatch&&!reconciliationMatch&&!savedMatch)) || !(receiptRoute || adminRoute || manualWrite || documentRoute || invitationRoute || reconciliationWrite || authPaths.get(url.pathname) === request.method ||
    request.method === 'GET' && (url.pathname === '/v1/session' || journalMatch || detailMatch || eventsMatch || eventDetailMatch || insightsMatch || reconciliationMatch || savedMatch))) return finish(response({error:'not_found'},404));
  if((receiptWrite||adminWrite||manualWrite||reconciliationWrite||documentWrite)&&!origin&&!config.origins.filter(value=>value.startsWith('nestwise-')).includes(request.headers.get('expo-origin')||''))return finish(response({error:'forbidden_origin'},403));
  // Cap credential bodies before the auth library parses JSON.
  let safeRequest=request;
  if (request.method==='POST'&&!documentWrite&&!receiptUpload) {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return finish(response({error:'invalid_body'},415));
    let raw: string;
    try {const limit=receiptWrite?65536:manualWrite||reconciliationWrite?16384:4096;raw=await limitedText(request,limit);}
    catch {return finish(response({error:'invalid_body'},413));}
    safeRequest=new Request(request.url,{method:request.method,headers:request.headers,body:raw});
  }
  let service: AuthService | undefined;
  try {
    if(invitationRoute) {
      let body:unknown;
      try {body=await safeRequest.json();} catch {return finish(response({error:'invalid_invitation'},400));}
      const ip=request.headers.get(config.development?'x-test-ip':'cf-connecting-ip') || 'unknown';
      const email=await acceptInvitation(body,ip,config.secret,invitationStore(env.AUTH_DATABASE_URL!));
      return finish(email?response({email}):response({error:'invalid_invitation'},400));
    }
    service=await connect(config,env.AUTH_DATABASE_URL!);
    if(authPaths.has(url.pathname)) return finish(await service.auth.handler(safeRequest));
    const session=await service.auth.api.getSession({headers:request.headers});
    if(!session) return finish(response({error:'unauthorized'},401));
    const db=ledger(env.NESTWISE_DATABASE_URL!);
    const subject=`better-auth:${session.user.id}`;
    if(receiptRoute&&receiptMatch)return finish(await receiptApi(receiptUpload?request:safeRequest,env,db,subject,receiptMatch[1],receiptMatch[2],receiptMatch[3]?.toLowerCase(),receiptMatch[4]));
    if(adminRoute&&adminMatch){
      if(!adminWrite)return finish(response(await db.workspaceAdministration(subject,adminMatch[1])));
      let payload;try{payload=parseWorkspaceCommand(await safeRequest.json());}catch{return finish(response({error:'invalid_workspace_command'},400));}
      return finish(response({id:await db.workspaceCommand(subject,adminMatch[1],payload)}));
    }
    if(manualWrite&&manualMatch){
      let payload;try{payload=parseManualOperation(await safeRequest.json());}catch{return finish(response({error:'invalid_manual_operation'},400));}
      return finish(response({id:await db.postManualOperation(subject,manualMatch[1],manualMatch[2],payload)}));
    }
    if(documentRoute&&documentMatch)return finish(await documentApi(request,env,db,subject,documentMatch[1],documentMatch[2],documentMatch[3]?.toLowerCase(),documentMatch[4]?.slice(1)));
    if(cancelMatch){
      let reason;try{reason=parseCancellation(await safeRequest.json());}catch{return finish(response({error:'invalid_reconciliation'},400));}
      return finish(response({id:await db.cancelReconciliation(subject,cancelMatch[1],cancelMatch[2],cancelMatch[3],reason)}));
    }
    if(savedMatch){
      if(reconciliationWrite){
        let payload;try{payload=parseSave(await safeRequest.json());}catch{return finish(response({error:'invalid_reconciliation'},400));}
        return finish(response({id:await db.saveReconciliation(subject,savedMatch[1],savedMatch[2],payload)}));
      }
      let cursor;try{cursor=savedCursor(url.searchParams);}catch{return finish(response({error:'invalid_filters'},400));}
      return finish(response(await db.readReconciliations(subject,savedMatch[1],savedMatch[2],cursor)));
    }
    if(reconciliationMatch){
      let filters;try{filters=candidateParams(url.searchParams);}catch{return finish(response({error:'invalid_filters'},400));}
      return finish(response(await db.userReconciliationCandidates(subject,reconciliationMatch[1],reconciliationMatch[2],filters.from,filters.to,filters.cursor)));
    }
    if(insightsMatch){
      let period;try{period=parsePeriodParams(url.searchParams);}catch{return finish(response({error:'invalid_filters'},400));}
      return finish(response(await db.userPeriodInsights(subject,insightsMatch[1],insightsMatch[2],period.from,period.to)));
    }
    if(eventDetailMatch){
      let before;try{before=detailBefore(url.searchParams);}catch{return finish(response({error:'invalid_filters'},400));}
      return finish(response(await db.userEventDetail(subject,eventDetailMatch[1],eventDetailMatch[2],eventDetailMatch[3],before)));
    }
    if(eventsMatch){
      let filters;try{filters=parseEventParams(url.searchParams);}catch{return finish(response({error:'invalid_filters'},400));}
      return finish(response(await db.userAccountEvents(subject,eventsMatch[1],eventsMatch[2],filters.status,filters.query,filters.cursor)));
    }
    if(detailMatch){
      let before;try{before=detailBefore(url.searchParams);}catch{return finish(response({error:'invalid_filters'},400));}
      return finish(response(await db.userJournalDetail(subject,detailMatch[1],detailMatch[2],detailMatch[3],before)));
    }
    if(journalMatch) {
      let query;
      try {query=parseHistoryParams(url.searchParams);}
      catch {return finish(response({error:'invalid_filters'},400));}
      return finish(response(await db.userJournalPage(subject,journalMatch[1],journalMatch[2],query.filters,query.cursor)));
    }
    return finish(response({user:{id:session.user.id,name:session.user.name,email:session.user.email},
      workspaces:await db.userAccess(subject)}));
  } catch(error) {
    if(error instanceof Error&&error.message==='bank_booking_conflict')return finish(response({error:error.message},409));
    if(error instanceof Error&&error.message==='invalid_bank_booking')return finish(response({error:error.message},400));
    if(error instanceof Error&&error.message==='ocr_rate_limited')return finish(response({error:error.message},429));
    if(error instanceof Error&&['ocr_not_configured','ocr_incomplete','ocr_unavailable'].includes(error.message))return finish(response({error:error.message},503));
    if(error instanceof Error&&['receipt_conflict','receipt_already_posted','receipt_limit','member_unavailable'].includes(error.message))return finish(response({error:error.message},409));
    if(error instanceof Error&&error.message==='invalid_receipt')return finish(response({error:error.message},400));
    if(error instanceof Error&&['workspace_command_conflict','workspace_limit','last_workspace_owner'].includes(error.message))return finish(response({error:error.message},409));
    if(error instanceof Error&&error.message==='invalid_workspace_command')return finish(response({error:error.message},400));
    if(error instanceof Error&&['manual_operation_conflict','manual_refund_exceeded'].includes(error.message))return finish(response({error:error.message},409));
    if(error instanceof Error&&error.message==='invalid_manual_operation')return finish(response({error:error.message},400));
    if(error instanceof Error&&error.message==='archive_full')return finish(response({error:'archive_full'},409));
    if(error instanceof Error&&['reconciliation_conflict','reconciliation_mismatch'].includes(error.message))return finish(response({error:error.message},409));
    if(error instanceof Error&&['invalid_reconciliation','invalid_document'].includes(error.message))return finish(response({error:error.message},400));
    if(error instanceof Error && error.message==='forbidden') return finish(response({error:'not_found'},404));
    if(error instanceof Error && ['invalid_cursor','invalid_filters'].includes(error.message))return finish(response({error:error.message},400));
    return finish(response({error:'temporarily_unavailable'},503));
  } finally { if(service) await service.close().catch(() => {}); }
}
