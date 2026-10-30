import type {Database} from './database';
import type {ReceiptEnv} from './receipts';
import {boundedBody,sha256,verified} from './documents';
import {receiptMime,parseReceipt} from '../src/domain/receipt';
import {parsePdfStatement,statementChecks,receiptCategoryTotals,documentDate} from '../src/domain/personal-documents';
import {recognizeStatement} from './statement-ocr';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Stored={hash:string;bytes:number;archived:boolean;revision:number;data:unknown};
export async function personalDocumentApi(request:Request,env:ReceiptEnv,db:Database,subject:string,workspace:string,account:string,kind:string,hash?:string,mode?:string){
 const call=(action:string,data:unknown={})=>db.personalDocument(subject,workspace,account,hash??null,action,data);
 await db.documentAccess(subject,workspace,account,request.method==='POST');
 // This call also enforces personal-only scope before reading private storage.
 const doc=await call(kind==='personal-expenses'?(hash?'expense':'expenses'):(hash?'get':'list'));
 if(kind==='personal-expenses'){
  if(request.method==='GET')return Response.json(doc);
  const body=await request.json();
  if(!body||Object.keys(body).sort().join(',')!=='bank_id,categories,extra,id,paid_on,review'||!uuid.test(body.id)||!uuid.test(body.review)||!documentDate(body.paid_on)||!Array.isArray(body.categories)||body.bank_id!==null&&(typeof body.bank_id!=='string'||body.bank_id.length>200))throw Error('invalid_personal_document');
  const receipts=await db.readReceipts(subject,workspace,account,hash!) as {review:{id:string;data:unknown}|null}[];
  const receipt=receipts.find(r=>r.review?.id===body.review);if(!receipt?.review)throw Error('receipt_conflict');
  receiptCategoryTotals(parseReceipt(receipt.review.data,true),body.categories,body.extra);
  return Response.json(await call('expense_save',body));
 }
 if(!env.STATEMENTS||!env.STATEMENTS_BACKUP)return Response.json({error:'archive_unavailable'},{status:503});
 if(!hash)return Response.json({documents:doc,ocr:env.NESTWISE_OCR_ENABLED==='true'&&!!env.NESTWISE_OCR_API_KEY&&!!env.NESTWISE_OCR_MODEL});
 const key=`personal-statements/v1/${workspace.toLowerCase()}/${account.toLowerCase()}/${hash}`;
 if(request.method==='POST'&&mode==='original'){
  const bytes=await boundedBody(request,5_000_000);
  if(receiptMime(bytes)!=='application/pdf'||await sha256(bytes)!==hash)throw Error('invalid_personal_document');
  await call('prepare',{bytes:bytes.length});
  for(const bucket of [env.STATEMENTS,env.STATEMENTS_BACKUP]){
   await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}});
   if(!await verified(bucket,key,hash,bytes.length,5_000_000))throw Error('archive_integrity_error');
  }
  await call('complete');return Response.json(await call('get'));
 }
 const stored=doc as Stored|null;if(!stored?.archived)return Response.json({error:'not_found'},{status:404});
 if(mode==='review'&&request.method==='POST'){
  const body=await request.json();if(!body||Object.keys(body).sort().join(',')!=='data,expected,id'||!uuid.test(body.id)||!Number.isInteger(body.expected)||body.expected<0||body.expected>999)throw Error('invalid_personal_document');
  const data=parsePdfStatement(body.data);
  if(!data.from||!data.to)throw Error('invalid_personal_document');
  const bank=await db.readBankFeed(subject,workspace,account,data.from,data.to) as {connection:{mask:string}|null};
  const checks=statementChecks(data,bank.connection?.mask);
  if(!checks.complete||checks.wrongAccount||checks.balanced===false)throw Error('invalid_personal_document');
  return Response.json(await call('review',{...body,data}));
 }
 const bytes=await verified(env.STATEMENTS,key,hash,stored.bytes,5_000_000)??await verified(env.STATEMENTS_BACKUP,key,hash,stored.bytes,5_000_000);
 if(!bytes)throw Error('archive_integrity_error');
 await db.documentAccess(subject,workspace,account,request.method==='POST');
 if(mode==='ocr'&&request.method==='POST'){
  const body=await request.json();if(!body||Object.keys(body).length!==1||body.consent!==true)return Response.json({error:'ocr_consent_required'},{status:400});
  if(env.NESTWISE_OCR_ENABLED!=='true'||!env.NESTWISE_OCR_API_KEY||!env.NESTWISE_OCR_MODEL)throw Error('ocr_not_configured');
  await call('claim_ocr');const data=await recognizeStatement(bytes,env.NESTWISE_OCR_API_KEY,env.NESTWISE_OCR_MODEL);
  await db.documentAccess(subject,workspace,account,true);return Response.json({data,review_required:true});
 }
 return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="statement-${hash.slice(0,12)}.pdf"`,'Content-Security-Policy':"sandbox; default-src 'none'"}});
}
