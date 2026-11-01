import type {Database} from './database';
import type {Access} from '../src/domain/live-navigation';
import {parsePdfStatement,statementChecks,type PdfStatement} from '../src/domain/personal-documents';

type Stored={hash:string;bytes:number;archived:boolean;revision:number;data:PdfStatement|null};
// Archiving recognized evidence never posts money or changes bank transactions.
export async function processStatement(db:Database,subject:string,workspace:string,account:string,hash:string,
 recognize:()=>Promise<PdfStatement>,archive:(target:string)=>Promise<void>){
 const access=await db.userAccess(subject) as Access['workspaces'];
 const space=access.find(w=>w.id===workspace&&w.kind==='personal'&&['owner','accountant'].includes(w.role));
 if(!space||!space.accounts.some(a=>a.id===account))throw Error('forbidden');
 const call=(target:string,action:string,data:unknown={})=>db.personalDocument(subject,workspace,target,hash,action,data);
 const today=new Date().toISOString().slice(0,10);
 const candidates=await Promise.all(space.accounts.map(async a=>{
  const bank=await db.readBankFeed(subject,workspace,a.id,today,today) as {connection:{mask:string;institution:string}|null};
  const doc=await call(a.id,'get') as Stored|null;
  return {...a,mask:bank.connection?.mask||'',doc};
 }));
 const safe=(data:PdfStatement,mask:string)=>{const checks=statementChecks(data,mask);return !!mask&&data.mask===mask&&checks.complete&&checks.balanced===true;};
 // A repeated upload (even to another account) reuses saved results, not another paid request.
 const existing=candidates.filter(c=>c.doc?.archived&&c.doc.data&&safe(parsePdfStatement(c.doc.data),c.mask));
 if(existing.length===1){const c=existing[0];return {account:c.id,document:c.doc,data:c.doc!.data,review_required:false};}
 const own=candidates.find(c=>c.id===account)!;
 if(own.doc?.data)return {account,document:own.doc,data:own.doc.data,review_required:false};
 const data=parsePdfStatement(await recognize());
 const matches=candidates.filter(c=>data.mask&&c.mask===data.mask);
 // Only a unique linked account in this same personal workspace can be selected automatically.
 const target=matches.length===1?matches[0]:own;
 await db.documentAccess(subject,workspace,target.id,true);
 if(target.id!==account)await archive(target.id);
 let document=await call(target.id,'get') as Stored;
 if(!document.data&&safe(data,target.mask)){
  try{document=await call(target.id,'review',{id:crypto.randomUUID(),expected:document.revision,data}) as Stored;}
  catch(error){
   // A parallel request may already have saved this exact file; never overwrite its review.
   if(!(error instanceof Error)||!error.message.includes('receipt_conflict'))throw error;
   document=await call(target.id,'get') as Stored;
   if(!document.data)throw error;
  }
 }
 return {account:target.id,document,data:document.data??data,review_required:!document.data};
}
