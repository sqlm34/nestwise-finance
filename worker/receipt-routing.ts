import {receiptCardTarget} from '../src/domain/receipt-routing';
import type {Access} from '../src/domain/live-navigation';
import type {ReceiptData} from '../src/domain/receipt';
import type {Database} from './database';
import type {ReceiptEnv} from './receipts';
import {verified} from './documents';
type Stored={hash:string;archived:boolean;bytes:number;mime:string;operation_id:string|null;review:{id:string;data:ReceiptData}|null};
export async function receiptTarget(env:ReceiptEnv,db:Database,subject:string,data:ReceiptData){
 if(!env.NESTWISE_RECEIPT_CARD_ROUTES||!data.card_last4)return null;
 return receiptCardTarget(env.NESTWISE_RECEIPT_CARD_ROUTES,data.card_last4,await db.userAccess(subject) as Access['workspaces']);
}
export async function receiptRoutingApi(request:Request,env:ReceiptEnv,db:Database,subject:string,workspace:string,account:string,hash:string){
 const rows=await db.readReceipts(subject,workspace,account,hash) as Stored[];const source=rows.find(r=>r.hash===hash);
 if(!source?.archived||!source.review)return Response.json({target:null});
 const target=await receiptTarget(env,db,subject,source.review.data);
 if(request.method==='GET')return Response.json({target});
 const body=await request.json();
 if(!body||Object.keys(body).join(',')!=='review'||body.review!==source.review.id)return Response.json({error:'receipt_conflict'},{status:409});
 if(!target)return Response.json({error:'receipt_card_unknown'},{status:409});
 if(target.account===account&&target.workspace===workspace)return Response.json({target});
 const spaces=await db.userAccess(subject) as Access['workspaces'];
 const personal=spaces.find(s=>s.id===workspace)?.kind==='personal';
 if(source.operation_id||personal&&await db.personalDocument(subject,workspace,account,hash,'expense',{}))return Response.json({error:'receipt_already_posted'},{status:409});
 await db.documentAccess(subject,target.workspace,target.account,true);
 if(!env.STATEMENTS||!env.STATEMENTS_BACKUP)return Response.json({error:'archive_unavailable'},{status:503});
 const sourceKey=`receipts/v1/${workspace.toLowerCase()}/${account.toLowerCase()}/${hash}`;
 const bytes=await verified(env.STATEMENTS,sourceKey,hash,source.bytes,5_000_000)??await verified(env.STATEMENTS_BACKUP,sourceKey,hash,source.bytes,5_000_000);
 if(!bytes)return Response.json({error:'archive_integrity_error'},{status:503});
 const key=`receipts/v1/${target.workspace.toLowerCase()}/${target.account.toLowerCase()}/${hash}`;
 await db.prepareReceipt(subject,target.workspace,target.account,hash,source.bytes,source.mime);
 for(const bucket of [env.STATEMENTS,env.STATEMENTS_BACKUP]){
  await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}});
  if(!await verified(bucket,key,hash,source.bytes,5_000_000))throw Error('archive_integrity_error');
 }
 await db.completeReceipt(subject,target.workspace,target.account,hash);
 const existing=await db.readReceipts(subject,target.workspace,target.account,hash) as Stored[];
 if(!existing[0]?.review){
  try{await db.reviewReceipt(subject,target.workspace,target.account,hash,crypto.randomUUID(),0,source.review.data);}
  catch(error){if(!(error instanceof Error)||error.message!=='receipt_conflict')throw error;}
 }
 return Response.json({target});
}
