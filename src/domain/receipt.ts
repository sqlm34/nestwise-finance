export type ReceiptData={supplier:string;date:string;currency:'USD';items:{description:string;cents:string|null}[];
  tax_cents:string|null;tip_cents:string|null;shipping_cents:string|null;discount_cents:string|null;total_cents:string|null};
const monetary=['tax_cents','tip_cents','shipping_cents','discount_cents','total_cents'] as const;
const fail=():never=>{throw new Error('invalid_receipt');};
const object=(v:unknown):Record<string,unknown>=>!v||typeof v!=='object'||Array.isArray(v)?fail():v as Record<string,unknown>;
function amount(v:unknown):string|null{if(v===null)return null;if(typeof v!=='string'||!/^(0|[1-9]\d{0,15})$/.test(v)||BigInt(v)>9007199254740991n)return fail();return v;}
function text(v:unknown,max:number):string{if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v))return fail();return v.trim();}
export function parseReceipt(value:unknown,confirmed=false):ReceiptData{
  const r=object(value),keys=['supplier','date','currency','items',...monetary];
  if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k))||r.currency!=='USD'||!Array.isArray(r.items)||r.items.length>100)return fail();
  const supplier=text(r.supplier,200),date=text(r.date,10);
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date<'1900-01-01'||date>'2199-12-31'))return fail();
  const items=r.items.map(v=>{const i=object(v);if(Object.keys(i).length!==2||!Object.hasOwn(i,'description')||!Object.hasOwn(i,'cents'))return fail();return {description:text(i.description,300),cents:amount(i.cents)};});
  const result:ReceiptData={supplier,date,currency:'USD',items,tax_cents:amount(r.tax_cents),tip_cents:amount(r.tip_cents),shipping_cents:amount(r.shipping_cents),discount_cents:amount(r.discount_cents),total_cents:amount(r.total_cents)};
  if(confirmed){
    if(!supplier||!date||!items.length||items.some(i=>!i.description||i.cents===null)||monetary.some(k=>result[k]===null)||BigInt(result.total_cents!)<=0n)return fail();
    if(items.reduce((sum,i)=>sum+BigInt(i.cents!),0n)+BigInt(result.tax_cents!)+BigInt(result.tip_cents!)+BigInt(result.shipping_cents!)-BigInt(result.discount_cents!)!==BigInt(result.total_cents!))return fail();
  }
  return result;
}
export function receiptMime(bytes:Uint8Array):'image/jpeg'|'image/png'|'image/webp'|'application/pdf'{
  if(bytes.length<12||bytes.length>5_000_000)return fail();
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
  if(ascii(0,5)==='%PDF-')return 'application/pdf';
  return fail();
}
