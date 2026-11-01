import taxonomy from '../data/accountant-categories.json';
import {personalCategories} from './personal-documents';
import {parseReceipt,type ReceiptData} from './receipt';
export const businessReceiptCategories=taxonomy.categories.filter(c=>c.id!=='tax_00');
export type ReceiptCategory=string|null;
export type ReceiptClassification={id:string;revision:number;review_id:string;categories:ReceiptCategory[];business_workspace:string|null;business_account:string|null};
export function isBusinessCategory(id:ReceiptCategory){return !!id&&businessReceiptCategories.some(c=>c.id===id);}
export function receiptCategoryLabel(id:ReceiptCategory,ru:boolean){return [...personalCategories,...businessReceiptCategories].find(c=>c.id===id)?.[ru?'ru':'en']||(ru?'Без категории':'Uncategorized');}
export function completeAbsentCharges(data:ReceiptData){
 const d=parseReceipt(data);
 const charges=['tax_cents','tip_cents','shipping_cents','discount_cents'] as const;
 if(d.total_cents===null||d.items.some(i=>i.cents===null))return d;
 const known=d.items.reduce((sum,i)=>sum+BigInt(i.cents!),0n)+BigInt(d.tax_cents??'0')+BigInt(d.tip_cents??'0')+BigInt(d.shipping_cents??'0')-BigInt(d.discount_cents??'0');
 // Fill only absent shared charges when visible items + visible charges already
 // explain the printed total. Unknown item prices and totals are never filled.
 if(known===BigInt(d.total_cents))for(const field of charges)if(d[field]===null)d[field]='0';
 return d;
}
export function classifyReceipt(data:ReceiptData,categories:ReceiptCategory[]){
 const d=parseReceipt(data,true);
 if(categories.length!==d.items.length||categories.some(c=>c!==null&&!personalCategories.some(p=>p.id===c)&&!isBusinessCategory(c)))throw Error('invalid_receipt_classification');
 const subtotal=d.items.reduce((s,i)=>s+BigInt(i.cents!),0n),total=BigInt(d.total_cents!);
 if(subtotal<=0n)throw Error('invalid_receipt_classification');
 // Largest-remainder allocation preserves every cent, including discounts and shared charges.
 const parts=d.items.map((item,index)=>({index,base:total*BigInt(item.cents!)/subtotal,remainder:total*BigInt(item.cents!)%subtotal}));
 let left=total-parts.reduce((n,p)=>n+p.base,0n);
 for(const part of [...parts].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1)){if(left<=0n)break;part.base++;left--;}
 const items=d.items.map((item,index)=>({...item,index,cents:item.cents!,gross_cents:parts[index].base.toString(),category:categories[index]}));
 const business=new Map<string,bigint>();let personal=0n;
 for(const item of items){if(isBusinessCategory(item.category))business.set(item.category!,(business.get(item.category!)||0n)+BigInt(item.gross_cents));else personal+=BigInt(item.gross_cents);}
 return {items,personal_cents:personal.toString(),business_cents:(total-personal).toString(),allocations:[...business].filter(([,n])=>n>0n).sort(([a],[b])=>a.localeCompare(b)).map(([category,n])=>({category,cents:n.toString()}))};
}
