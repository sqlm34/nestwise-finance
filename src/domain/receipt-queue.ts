import {receiptMime} from './receipt';
import {scopeKey,type DraftScope} from './operation-draft';
export type QueuedReceipt={scope:DraftScope;hash:string;name:string;bytes:Uint8Array;created:string};
export interface ReceiptQueueStore {
 list(scope:DraftScope):Promise<QueuedReceipt[]>;
 put(row:QueuedReceipt):Promise<void>;
 remove(scope:DraftScope,hash:string):Promise<void>;
}
export function validateQueuedReceipt(row:QueuedReceipt,scope:DraftScope){
 if(!row||scopeKey(row.scope)!==scopeKey(scope)||!/^([a-f0-9]{64})$/.test(row.hash)||typeof row.name!=='string'||row.name.length>512||!Number.isFinite(Date.parse(row.created))||!(row.bytes instanceof Uint8Array))throw Error('receipt_queue_corrupt');
 receiptMime(row.bytes);return row;
}
/** Uploads are content addressed. Keep the original until both archives are confirmed. */
export async function deliverQueuedReceipt(row:QueuedReceipt,send:(row:QueuedReceipt)=>Promise<{hash:string;archived:boolean}>,store:ReceiptQueueStore){
 validateQueuedReceipt(row,row.scope);
 const result=await send(row);
 if(result.hash!==row.hash||result.archived!==true)throw Error('receipt_archive_unconfirmed');
 await store.remove(row.scope,row.hash);
}
