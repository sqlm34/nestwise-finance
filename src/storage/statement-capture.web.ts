import type {ReceiptFile} from '../receipt-file';
export type CapturedStatement={name:string;hash:string;mime:ReceiptFile['mime'];editor:string;queued:boolean};
function transaction<T>(scope:string,write:boolean,action:(store:IDBObjectStore,done:(v:T)=>void)=>void):Promise<T>{return new Promise((resolve,reject)=>{
 const request=indexedDB.open('nestwise-statement-capture',1);request.onupgradeneeded=()=>request.result.createObjectStore('files');request.onerror=()=>reject(Error('capture_storage_failed'));request.onblocked=()=>reject(Error('capture_storage_blocked'));
 request.onsuccess=()=>{const db=request.result,tx=db.transaction('files',write?'readwrite':'readonly');let value:T;tx.oncomplete=()=>{db.close();resolve(value);};tx.onabort=tx.onerror=()=>{db.close();reject(Error('capture_storage_failed'));};action(tx.objectStore('files'),v=>{value=v;});};
 });}
export const statementCapture={
 read:(scope:string)=>transaction<CapturedStatement|null>(scope,false,(s,done)=>{const r=s.get(scope);r.onsuccess=()=>done(r.result?.value??null);}),
 save:(scope:string,value:CapturedStatement,file?:ReceiptFile,active=true)=>transaction<void>(scope,true,(s,done)=>{const r=s.get(scope+':'+value.hash);r.onsuccess=()=>{const record={value,bytes:file?file.bytes:r.result?.bytes};if(active)s.put(record,scope);s.put(record,scope+':'+value.hash);done();};}),
 list:(scope:string)=>transaction<CapturedStatement[]>(scope,false,(s,done)=>{const values:CapturedStatement[]=[];const cursor=s.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c){done(values);return;}if(String(c.key).startsWith(scope+':'))values.push(c.value.value);c.continue();};}),
 bytes:(scope:string,value:CapturedStatement)=>transaction<Uint8Array>(scope,false,(s,done)=>{const r=s.get(scope+':'+value.hash);r.onsuccess=()=>{if(r.result?.value.hash!==value.hash||!r.result.bytes){s.transaction.abort();return;}done(r.result.bytes);};}),
};
