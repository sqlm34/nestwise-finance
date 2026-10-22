import {parseReceipt,receiptMime} from '../src/domain/receipt';
import {parseManualOperation} from '../src/domain/manual-operation';
import {boundedBody,sha256,verified,type DocumentEnv} from './documents';
import type {Database} from './database';
import {recognizeReceipt} from './receipt-ocr';
export type ReceiptEnv=DocumentEnv&{NESTWISE_OCR_ENABLED?:string;NESTWISE_OCR_API_KEY?:string;NESTWISE_OCR_MODEL?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function receiptApi(request:Request,env:ReceiptEnv,db:Database,subject:string,workspace:string,account:string,hash?:string,mode?:string){
  const write=request.method==='POST';
  await db.documentAccess(subject,workspace,account,write);
  if(mode==='ocr'&&!write){
    return Response.json({enabled:env.NESTWISE_OCR_ENABLED==='true'&&!!env.NESTWISE_OCR_API_KEY&&!!env.NESTWISE_OCR_MODEL&&!!env.STATEMENTS&&!!env.STATEMENTS_BACKUP,provider:'OpenAI',review_required:true});
  }
  if(mode==='original'){
    if(!env.STATEMENTS||!env.STATEMENTS_BACKUP)return Response.json({error:'archive_unavailable'},{status:503});
    const key=`receipts/v1/${workspace.toLowerCase()}/${account.toLowerCase()}/${hash}`;
    if(write){
      let bytes:Uint8Array,mime:string;
      try{bytes=await boundedBody(request,5_000_000);mime=receiptMime(bytes);if(await sha256(bytes)!==hash)throw new Error();}
      catch(error){return Response.json({error:'invalid_receipt'},{status:error instanceof Error&&error.message==='document_too_large'?413:400});}
      await db.prepareReceipt(subject,workspace,account,hash!,bytes.length,mime);
      for(const bucket of [env.STATEMENTS,env.STATEMENTS_BACKUP]){
        await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}});
        if(!await verified(bucket,key,hash!,bytes.length,5_000_000))return Response.json({error:'archive_integrity_error'},{status:503});
      }
      await db.completeReceipt(subject,workspace,account,hash!);return Response.json({hash,archived:true});
    }
    const rows=await db.readReceipts(subject,workspace,account,hash!) as {hash:string;bytes:number;mime:string;archived:boolean}[];
    const doc=rows.find(r=>r.hash===hash&&r.archived);if(!doc)return Response.json({error:'not_found'},{status:404});
    const bytes=await verified(env.STATEMENTS,key,hash!,doc.bytes,5_000_000)??await verified(env.STATEMENTS_BACKUP,key,hash!,doc.bytes,5_000_000);
    if(!bytes)return Response.json({error:'archive_integrity_error'},{status:503});
    await db.documentAccess(subject,workspace,account,false);
    return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="receipt-${hash!.slice(0,12)}.${doc.mime==='application/pdf'?'pdf':doc.mime==='image/jpeg'?'jpg':doc.mime==='image/png'?'png':'webp'}"`,'Content-Security-Policy':"sandbox; default-src 'none'"}});
  }
  if(!write){
    const params=new URL(request.url).searchParams,before=params.get('before');
    if([...params.keys()].some(k=>k!=='before')||params.getAll('before').length>1||(before!==null&&!/^[0-9a-f]{64}$/.test(before))||(hash&&params.size))return Response.json({error:'invalid_receipt'},{status:400});
    return Response.json(await db.readReceipts(subject,workspace,account,hash||null,before));
  }
  let body:Record<string,unknown>;try{const value=await request.json();if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();body=value;}catch{return Response.json({error:'invalid_receipt'},{status:400});}
  if(mode==='ocr'){
    if(Object.keys(body).length!==1||body.consent!==true)return Response.json({error:'ocr_consent_required'},{status:400});
    if(env.NESTWISE_OCR_ENABLED!=='true'||!env.NESTWISE_OCR_API_KEY||!env.NESTWISE_OCR_MODEL||!env.STATEMENTS||!env.STATEMENTS_BACKUP)return Response.json({error:'ocr_not_configured'},{status:503});
    const rows=await db.readReceipts(subject,workspace,account,hash!) as {hash:string;bytes:number;archived:boolean;operation_id:string|null}[];
    const doc=rows.find(r=>r.hash===hash&&r.archived);if(!doc)return Response.json({error:'not_found'},{status:404});
    if(doc.operation_id)return Response.json({error:'receipt_already_posted'},{status:409});
    const key=`receipts/v1/${workspace.toLowerCase()}/${account.toLowerCase()}/${hash}`;
    const bytes=await verified(env.STATEMENTS,key,hash!,doc.bytes,5_000_000)??await verified(env.STATEMENTS_BACKUP,key,hash!,doc.bytes,5_000_000);
    if(!bytes)return Response.json({error:'archive_integrity_error'},{status:503});
    await db.claimReceiptOcr(subject,workspace,account,hash!);
    const data=await recognizeReceipt(bytes,env.NESTWISE_OCR_API_KEY,env.NESTWISE_OCR_MODEL);
    await db.documentAccess(subject,workspace,account,true);
    return Response.json({data,review_required:true});
  }
  if(mode==='review'){
    let data;try{
      if(Object.keys(body).length!==3||typeof body.id!=='string'||!uuid.test(body.id)||!Number.isInteger(body.expected)||Number(body.expected)<0||Number(body.expected)>999)throw new Error();
      data=parseReceipt(body.data);
    }catch{return Response.json({error:'invalid_receipt'},{status:400});}
    return Response.json({id:await db.reviewReceipt(subject,workspace,account,hash!,body.id as string,body.expected as number,data)});
  }
  if(mode==='post'){
    try{
      if(Object.keys(body).length!==3||typeof body.review!=='string'||!uuid.test(body.review)||typeof body.operation!=='string'||!uuid.test(body.operation))throw new Error();
      parseManualOperation({id:body.operation,kind:'expense',paid_on:body.paid_on,amount_cents:'1',note:'',destination_account:null,reference_operation:null,allocations:[{category:'other_expense',cents:'1'}]});
    }catch{return Response.json({error:'invalid_receipt'},{status:400});}
    return Response.json({id:await db.postReceipt(subject,workspace,account,hash!,body.review as string,body.operation as string,body.paid_on as string)});
  }
  return Response.json({error:'not_found'},{status:404});
}
