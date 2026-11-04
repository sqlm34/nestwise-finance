import {scopeKey,type DraftScope} from '../domain/operation-draft';
import {validateQueuedReceipt,type ReceiptQueueStore,type QueuedReceipt} from '../domain/receipt-queue';
function transaction<T>(scope:DraftScope,write:boolean,work:(store:IDBObjectStore,done:(v:T)=>void)=>void):Promise<T>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('nestwise-receipt-outbox',1);request.onupgradeneeded=()=>request.result.createObjectStore('receipts');
  request.onerror=()=>reject(Error('receipt_storage_unavailable'));request.onblocked=()=>reject(Error('receipt_storage_blocked'));
  request.onsuccess=()=>{const db=request.result,tx=db.transaction('receipts',write?'readwrite':'readonly');let result:T;
   tx.oncomplete=()=>{db.close();resolve(result);};tx.onabort=()=>{db.close();reject(Error('receipt_storage_unavailable'));};
   try{work(tx.objectStore('receipts'),v=>{result=v;});}catch{tx.abort();}
  };
 });
}
export const receiptQueueStore:ReceiptQueueStore={
 list:scope=>transaction(scope,false,(store,done)=>{const read=store.getAll();read.onsuccess=()=>{
  try{done((read.result as QueuedReceipt[]).filter(r=>scopeKey(r.scope)===scopeKey(scope)).map(r=>validateQueuedReceipt(r,scope)).sort((a,b)=>a.created.localeCompare(b.created)));}catch{store.transaction.abort();}
 };}),
 put:row=>transaction(row.scope,true,(store,done)=>{
  validateQueuedReceipt(row,row.scope);const key=scopeKey(row.scope)+':'+row.hash;
  const read=store.getAll();read.onsuccess=()=>{if(read.result.some((r:QueuedReceipt)=>scopeKey(r.scope)===scopeKey(row.scope)&&r.hash===row.hash)){done(undefined);return;}
   if(read.result.filter((r:QueuedReceipt)=>scopeKey(r.scope)===scopeKey(row.scope)).length>=20){store.transaction.abort();return;}
   store.put(row,key);done(undefined);
  };
 }),
 remove:(scope,hash)=>transaction(scope,true,(store,done)=>{store.delete(scopeKey(scope)+':'+hash);done(undefined);}),
};
