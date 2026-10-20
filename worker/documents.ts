import {statementFingerprints,reviewEvidence} from '../src/domain/statement-evidence';
import {documentLimit,parseDocuments} from '../src/domain/documents';
import {previewStatement} from '../src/domain/statement';
import type {Database} from './database';
export type PrivateBucket={
  get(key:string):Promise<{size:number;arrayBuffer():Promise<ArrayBuffer>}|null>;
  put(key:string,bytes:Uint8Array,options:{onlyIf:{etagDoesNotMatch:string};httpMetadata:{contentType:string}}):Promise<unknown>;
};
export type DocumentEnv={STATEMENTS?:PrivateBucket;STATEMENTS_BACKUP?:PrivateBucket};
const json=(value:unknown,status=200)=>Response.json(value,{status});
export async function sha256(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(bytes))),b=>b.toString(16).padStart(2,'0')).join('');}
async function boundedBody(request:Request){
  if(Number(request.headers.get('content-length')||0)>documentLimit)throw new Error('document_too_large');
  const reader=request.body?.getReader();if(!reader)throw new Error('invalid_document');
  const chunks:Uint8Array[]=[];let length=0;
  try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;
    if(length>documentLimit){await reader.cancel();throw new Error('document_too_large');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
async function verified(bucket:PrivateBucket,key:string,hash:string,size:number){
  try{const object=await bucket.get(key);if(!object||object.size!==size||object.size>documentLimit)return null;
    const bytes=new Uint8Array(await object.arrayBuffer());return bytes.length===size&&await sha256(bytes)===hash?bytes:null;
  }catch{return null;}
}
export async function documentApi(request:Request,env:DocumentEnv,db:Database,subject:string,workspace:string,account:string,hash?:string,mode:string='download'){
  const write=request.method==='POST';
  // Recheck live ACL before consuming a private body or touching storage.
  await db.documentAccess(subject,workspace,account,write);
  if(!env.STATEMENTS||!env.STATEMENTS_BACKUP)return json({error:'archive_unavailable'},503);
  if(!hash)return json(await db.readDocuments(subject,workspace,account));
  const key=`v1/${workspace.toLowerCase()}/${account.toLowerCase()}/${hash}`;
  if(write){
    if(request.headers.get('content-type')?.split(';')[0]!=='text/csv')return json({error:'invalid_document'},415);
    let bytes:Uint8Array;
    try{bytes=await boundedBody(request);}catch(error){return json({error:'invalid_document'},error instanceof Error&&error.message==='document_too_large'?413:400);}
    try{
      if(!bytes.length||await sha256(bytes)!==hash)throw new Error();
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const preview=previewStatement(text,'chase','Archive');
      if(!preview.rows.length||preview.errors.length)throw new Error();
    }catch{return json({error:'invalid_document'},400);}
    await db.prepareDocument(subject,workspace,account,hash,bytes.length);
    // A partial failure remains pending; retrying the same hash never overwrites originals.
    for(const bucket of [env.STATEMENTS,env.STATEMENTS_BACKUP]){
      await bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/octet-stream'}});
      if(!await verified(bucket,key,hash,bytes.length))return json({error:'archive_integrity_error'},503);
    }
    await db.completeDocument(subject,workspace,account,hash);
    return json({hash,archived:true});
  }
  const doc=parseDocuments(await db.readDocuments(subject,workspace,account)).find(d=>d.hash===hash&&d.archived);
  if(!doc)return json({error:'not_found'},404);
  const primary=await verified(env.STATEMENTS,key,hash,doc.bytes);
  const backup=mode==='verify'||!primary?await verified(env.STATEMENTS_BACKUP,key,hash,doc.bytes):null;
  if(mode==='verify')return json({hash,primary:!!primary,backup:!!backup},primary||backup?200:503);
  const bytes=primary??backup;if(!bytes)return json({error:'archive_integrity_error'},503);
  // Check access again after storage I/O, including membership revoked mid-request.
  await db.documentAccess(subject,workspace,account,false);
  if(mode==='review'){
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),preview=previewStatement(text,'chase','Archive');
    const fingerprints=await statementFingerprints(preview.rows,text=>sha256(new TextEncoder().encode(text)));
    const evidence=await db.documentEvidence(subject,workspace,account,hash,[...fingerprints.values()]);
    return json(reviewEvidence(text,hash,fingerprints,evidence,primary?'primary':'backup',new Date().toISOString()));
  }
  return new Response(Uint8Array.from(bytes),{headers:{'Content-Type':'application/octet-stream',
    'Content-Disposition':`attachment; filename="statement-${hash.slice(0,12)}.csv"`,'Content-Security-Policy':"sandbox; default-src 'none'",'X-Archive-Copy':primary?'primary':'backup'}});
}
