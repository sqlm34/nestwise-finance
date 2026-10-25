import {parsePartsCommand} from '../src/domain/parts';
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
import {nativeAppOrigin,trustedNativeOrigin} from './auth-origins';

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
    const nativeOrigin=nativeAppOrigin(env.ENVIRONMENT);
    if(!nativeOrigin)return null;
    const origins = [base.origin, nativeOrigin];
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
  const purchaseMatch=request.method==='GET'?/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/purchase-candidates$/i.exec(url.pathname):null;
  const partsMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/parts$/i.exec(url.pathname);
  const partsRoute=!!partsMatch&&!url.search&&['GET','POST'].includes(request.method);
  const reportMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/reports(?:\/(mappings|snapshots|owner-expenses|reimbursements|cancellations)(?:\/([0-9a-f-]{36}))?)?$/i.exec(url.pathname);
  const reportRoute=!!reportMatch&&(request.method==='GET'&&(!reportMatch[3]||reportMatch[3]==='snapshots')||request.method==='POST'&&!!reportMatch[3]&&!reportMatch[4]);
  const reportWrite=reportRoute&&request.method==='POST';
  const authPaths = new Map([['/api/auth/sign-in/email','POST'],['/api/auth/sign-out','POST'],['/api/auth/get-session','GET']]);
  const invitationRoute=url.pathname==='/v1/invitations/accept' && request.method==='POST';
  const receiptMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/receipts(?:\/([0-9a-f]{64})(?:\/(original|review|post|ocr))?)?$/i.exec(url.pathname);
  const receiptList=!!receiptMatch&&!receiptMatch[3]&&request.method==='GET';
  const receiptRoute=receiptList||!!receiptMatch&&!url.search&&(request.method==='GET'&&(!receiptMatch[4]||receiptMatch[4]==='original'||receiptMatch[4]==='ocr')||request.method==='POST'&&!!receiptMatch[4]);
  const receiptWrite=receiptRoute&&request.method==='POST';
  const receiptUpload=receiptWrite&&receiptMatch?.[4]==='original';
  const adminMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/administration$/i.exec(url.pathname);
  const adminRoute=!!adminMatch&&!url.search&&['GET','POST'].includes(request.method);
  const adminWrite=adminRoute&&request.method==='POST';
  const manualMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/operations$/i.exec(url.pathname);
  const manualWrite=!!manualMatch&&request.method==='POST'&&!url.search;
  const savedMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/reconciliations$/i.exec(url.pathname);
  const cancelMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/reconciliations\/([0-9a-f-]{36})\/cancel$/i.exec(url.pathname);
  const documentMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/documents(?:\/([0-9a-f]{64})(\/(?:verify|review|book|period))?)?$/i.exec(url.pathname);
  const documentRoute=!!documentMatch&&!url.search&&(request.method==='GET'&&documentMatch[4]!=='/book'||request.method==='POST'&&!!documentMatch[3]&&(!documentMatch[4]||documentMatch[4]==='/book'||documentMatch[4]==='/period'));
  const periodsMatch=request.method==='GET'&&!url.search?/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/statement-periods$/i.exec(url.pathname):null;
  const documentWrite=documentRoute&&request.method==='POST';
  const reconciliationWrite=request.method==='POST'&&(savedMatch||cancelMatch);
  const reconciliationMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/reconciliation-candidates$/i.exec(url.pathname);
  const insightsMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/(?:cash-)?insights$/i.exec(url.pathname);
  const eventsMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/events$/i.exec(url.pathname);
  const eventDetailMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/events\/([0-9a-f-]{36})$/i.exec(url.pathname);
  const journalMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/journal$/i.exec(url.pathname);
  const detailMatch=/^\/v1\/user\/workspaces\/([0-9a-f-]{36})\/accounts\/([0-9a-f-]{36})\/journal\/([0-9a-f-]{36})$/i.exec(url.pathname);
  if ((url.search&&!purchaseMatch&&(!reportRoute||reportWrite||!!reportMatch?.[3])&&(reconciliationWrite||!receiptList&&!journalMatch&&!detailMatch&&!eventsMatch&&!eventDetailMatch&&!insightsMatch&&!reconciliationMatch&&!savedMatch)) || !(purchaseMatch || partsRoute || reportRoute || periodsMatch || receiptRoute || adminRoute || manualWrite || documentRoute || invitationRoute || reconciliationWrite || authPaths.get(url.pathname) === request.method ||
    request.method === 'GET' && (url.pathname === '/v1/session' || journalMatch || detailMatch || eventsMatch || eventDetailMatch || insightsMatch || reconciliationMatch || savedMatch))) return finish(response({error:'not_found'},404));
  if((partsRoute&&request.method==='POST'||reportWrite||receiptWrite||adminWrite||manualWrite||reconciliationWrite||documentWrite)&&!origin&&!trustedNativeOrigin(request.headers.get('expo-origin'),config.origins))return finish(response({error:'forbidden_origin'},403));
  // Cap credential bodies before the auth library parses JSON.
  let safeRequest=request;
  if (request.method==='POST'&&!documentWrite&&!receiptUpload) {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return finish(response({error:'invalid_body'},415));
    let raw: string;
    try {const limit=reportWrite?16384:receiptWrite?65536:manualWrite||reconciliationWrite?16384:4096;raw=await limitedText(request,limit);}
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
    if(purchaseMatch){
      const q=url.searchParams;const query=q.get('query')??'',from=q.get('from'),to=q.get('to'),min=q.get('min')??'0';
      if([...q.keys()].some(k=>!['query','from','to','min'].includes(k)||q.getAll(k).length!==1)||query.length>120||!/^(0|[1-9][0-9]{0,15})$/.test(min)||BigInt(min)>9007199254740991n||[from,to].some(v=>v!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v))||from&&to&&from>to)return finish(response({error:'invalid_parts'},400));
      return finish(response(await db.purchaseCandidates(subject,purchaseMatch[1],purchaseMatch[2],query,from,to,min)));
    }
    if(partsRoute&&partsMatch){
      if(request.method==='GET')return finish(response(await db.readParts(subject,partsMatch[1],partsMatch[2])));
      let data;try{data=parsePartsCommand(await safeRequest.json());}catch{return finish(response({error:'invalid_parts'},400));}
      return finish(response({id:await db.partsCommand(subject,partsMatch[1],partsMatch[2],data)}));
    }
    if(reportRoute&&reportMatch){
      const workspace=reportMatch[1],account=reportMatch[2];
      if(request.method==='GET'){
        if(reportMatch[3]==='snapshots')return finish(response(await db.readReportSnapshots(subject,workspace,account,reportMatch[4]??null)));
        let period;try{period=parsePeriodParams(url.searchParams);}catch{return finish(response({error:'invalid_report'},400));}
        return finish(response(await db.reportInput(subject,workspace,account,period.from,period.to)));
      }
      let data;try{data=await safeRequest.json();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();}catch{return finish(response({error:'invalid_report'},400));}
      const reportId=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      if(!reportId(data.id)||(['mappings','owner-expenses','reimbursements'].includes(reportMatch[3])&&!reportId(data.transaction))
        ||reportMatch[3]==='reimbursements'&&!reportId(data.link)
        ||reportMatch[3]==='cancellations'&&(!reportId(data.target)||typeof data.reason!=='string'||!['purchase','reimbursement'].includes(data.kind))
        ||reportMatch[3]==='mappings'&&(!Number.isInteger(data.line)||data.line<1||data.line>2147483647||!Number.isInteger(data.expected_revision)||data.expected_revision<0||data.expected_revision>99))return finish(response({error:'invalid_report'},400));
      if(reportMatch[3]==='cancellations')return finish(response({id:await db.cancelOwnerExpense(subject,workspace,account,data)}));
      if(['owner-expenses','reimbursements'].includes(reportMatch[3]))return finish(response({id:await db.ownerExpense(subject,workspace,account,data,reportMatch[3]==='reimbursements')}));
      if(reportMatch[3]==='mappings')return finish(response({id:await db.proposeReportMapping(subject,workspace,account,data)}));
      if(Object.keys(data).length!==4||!['id','from','to','hash'].every(k=>typeof data[k]==='string')||! /^[0-9a-f-]{36}$/i.test(data.id)||! /^[0-9a-f]{64}$/.test(data.hash))return finish(response({error:'invalid_report'},400));
      try{parsePeriodParams(new URLSearchParams({from:data.from,to:data.to}));}catch{return finish(response({error:'invalid_report'},400));}
      return finish(response(await db.saveReportSnapshot(subject,workspace,account,data.id,data.from,data.to,data.hash)));
    }
    if(adminRoute&&adminMatch){
      if(!adminWrite)return finish(response(await db.workspaceAdministration(subject,adminMatch[1])));
      let payload;try{payload=parseWorkspaceCommand(await safeRequest.json());}catch{return finish(response({error:'invalid_workspace_command'},400));}
      return finish(response({id:await db.workspaceCommand(subject,adminMatch[1],payload)}));
    }
    if(manualWrite&&manualMatch){
      let payload;try{payload=parseManualOperation(await safeRequest.json());}catch{return finish(response({error:'invalid_manual_operation'},400));}
      return finish(response({id:await db.postManualOperation(subject,manualMatch[1],manualMatch[2],payload)}));
    }
    if(periodsMatch)return finish(response(await db.readStatementPeriods(subject,periodsMatch[1],periodsMatch[2],null)));
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
      return finish(response(await (url.pathname.endsWith('/cash-insights')?db.userCashInsights:db.userPeriodInsights)(subject,insightsMatch[1],insightsMatch[2],period.from,period.to)));
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
    if(error instanceof Error&&['report_conflict','report_limit','parts_conflict','parts_limit','parts_overallocated','parts_search_limit'].includes(error.message))return finish(response({error:error.message},409));
    if(error instanceof Error&&['invalid_report','report_too_large','invalid_parts'].includes(error.message))return finish(response({error:error.message},400));
    if(error instanceof Error&&error.message==='statement_period_conflict')return finish(response({error:error.message},409));
    if(error instanceof Error&&error.message==='invalid_statement_period')return finish(response({error:error.message},400));
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
