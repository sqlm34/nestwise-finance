import {parseReceipt,type ReceiptData} from './receipt';
export function sameReceiptData(left:unknown,right:unknown){
  return JSON.stringify(parseReceipt(left))===JSON.stringify(parseReceipt(right));
}

/** Diagnostics are review aids, never inferred money or accounting decisions. */
export function receiptReviewChecks(value:ReceiptData){
  const data=parseReceipt(value);
  const missing:string[]=[];
  if(!data.supplier)missing.push('supplier');if(!data.date)missing.push('date');
  if(!data.items.length)missing.push('items');
  data.items.forEach((item,i)=>{if(!item.description)missing.push(`item_${i+1}_description`);if(item.cents===null)missing.push(`item_${i+1}_amount`);});
  const fields=['tax_cents','tip_cents','shipping_cents','discount_cents','total_cents'] as const;
  fields.forEach(field=>{if(data[field]===null)missing.push(field);});
  const completeAmounts=data.items.length>0&&data.items.every(item=>item.cents!==null)&&fields.every(field=>data[field]!==null);
  const totalsMatch=completeAmounts?data.items.reduce((sum,item)=>sum+BigInt(item.cents!),0n)+BigInt(data.tax_cents!)+BigInt(data.tip_cents!)+BigInt(data.shipping_cents!)-BigInt(data.discount_cents!)===BigInt(data.total_cents!):null;
  return {missing,totalsMatch};
}

export function possibleReceiptDuplicates(data:ReceiptData,hash:string,rows:{hash:string;review:{data:ReceiptData}|null}[]){
  if(!data.supplier.trim()||!data.date||data.total_cents===null)return [];
  const supplier=data.supplier.trim().toLocaleLowerCase('en-US');
  return rows.filter(row=>row.hash!==hash&&row.review&&row.review.data.supplier.trim().toLocaleLowerCase('en-US')===supplier&&row.review.data.date===data.date&&row.review.data.total_cents===data.total_cents).map(row=>row.hash);
}
