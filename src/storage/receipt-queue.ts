import {Directory,File,Paths} from 'expo-file-system';
import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import {scopeKey} from '../domain/operation-draft';
import {validateQueuedReceipt,type ReceiptQueueStore,type QueuedReceipt} from '../domain/receipt-queue';
let tail:Promise<unknown>=Promise.resolve();
function exclusive<T>(work:()=>Promise<T>):Promise<T>{const next=tail.then(work,work);tail=next.catch(()=>{});return next;}
async function directory(scope:QueuedReceipt['scope']){
 const key=await digestStringAsync(CryptoDigestAlgorithm.SHA256,scopeKey(scope));
 const dir=new Directory(Paths.document,'receipt-outbox-v1',key);dir.create({intermediates:true,idempotent:true});return dir;
}
// Private application documents, never cache: OS cache cleanup must not remove originals.
export const receiptQueueStore:ReceiptQueueStore={
 list:scope=>exclusive(async()=>{
  const dir=await directory(scope),rows:QueuedReceipt[]=[];
  for(const entry of dir.list())if(entry instanceof File&&entry.name.endsWith('.json')){
   const data=JSON.parse(await entry.text());
   if(!/^[a-f0-9]{64}$/.test(data.hash))throw Error('receipt_queue_corrupt');
   const bytes=await new File(dir,data.hash+'.bin').bytes();rows.push(validateQueuedReceipt({...data,bytes},scope));
  }
  return rows.sort((a,b)=>a.created.localeCompare(b.created));
 }),
 put:row=>exclusive(async()=>{
  validateQueuedReceipt(row,row.scope);const dir=await directory(row.scope),file=new File(dir,row.hash+'.json');
  if(file.exists)return;
  if(dir.list().filter(f=>f.name.endsWith('.json')).length>=20)throw Error('receipt_queue_full');
  const original=new File(dir,row.hash+'.bin');original.create({overwrite:true});await original.write(row.bytes);
  const temporary=new File(dir,row.hash+'.pending');
  temporary.create({overwrite:true});await temporary.write(JSON.stringify({scope:row.scope,hash:row.hash,name:row.name,created:row.created}));
  temporary.move(file);
 }),
 remove:(scope,hash)=>exclusive(async()=>{if(!/^[a-f0-9]{64}$/.test(hash))throw Error('invalid_hash');const dir=await directory(scope),file=new File(dir,hash+'.json');if(file.exists)file.delete();const original=new File(dir,hash+'.bin');if(original.exists)original.delete();}),
};
