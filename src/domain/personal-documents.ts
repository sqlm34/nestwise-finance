import {parseReceipt,type ReceiptData} from './receipt';
export const personalCategories=[
 {id:'groceries',ru:'Продукты',en:'Groceries'},{id:'dining',ru:'Кафе и рестораны',en:'Dining'},
 {id:'household',ru:'Для дома',en:'Household'},{id:'transport',ru:'Транспорт и бензин',en:'Transport & fuel'},
 {id:'health',ru:'Здоровье',en:'Health'},{id:'clothing',ru:'Одежда',en:'Clothing'},
 {id:'children',ru:'Дети',en:'Children'},{id:'pets',ru:'Животные',en:'Pets'},
 {id:'entertainment',ru:'Отдых',en:'Entertainment'},{id:'subscriptions',ru:'Подписки',en:'Subscriptions'},
 {id:'utilities',ru:'Коммунальные услуги',en:'Utilities'},{id:'other',ru:'Другое',en:'Other'},
] as const;
export type PersonalCategory=typeof personalCategories[number]['id'];
export function personalCategory(v:unknown):PersonalCategory{if(!personalCategories.some(c=>c.id===v))throw Error('invalid_personal_document');return v as PersonalCategory;}
export function receiptCategoryTotals(data:ReceiptData,items:string[],extra:string){
 const d=parseReceipt(data,true);if(items.length!==d.items.length)throw Error('invalid_personal_document');
 const totals=new Map<string,bigint>();
 d.items.forEach((item,i)=>{const key=personalCategory(items[i]);totals.set(key,(totals.get(key)||0n)+BigInt(item.cents!));});
 const key=personalCategory(extra),adjustment=BigInt(d.tax_cents!)+BigInt(d.tip_cents!)+BigInt(d.shipping_cents!)-BigInt(d.discount_cents!);
 totals.set(key,(totals.get(key)||0n)+adjustment);
 return [...totals].map(([category,cents])=>({category,cents:cents.toString()}));
}
export type PdfStatement={bank:string;mask:string;from:string;to:string;currency:'USD';opening_cents:string|null;closing_cents:string|null;complete:boolean;rows:{date:string;description:string;cents:string|null}[]};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid_personal_document');return v as Record<string,unknown>;};
const text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max||/[\u0000-\u001f\u007f]/.test(v))throw Error('invalid_personal_document');return v.trim();};
export function documentDate(v:unknown){const s=text(v,10);if(s&&(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s||s<'1900-01-01'||s>'2199-12-31'))throw Error('invalid_personal_document');return s;}
function amount(v:unknown){if(v===null)return null;if(typeof v!=='string'||! /^-?(0|[1-9]\d{0,15})$/.test(v)||BigInt(v)>9007199254740991n||BigInt(v)<-9007199254740991n)throw Error('invalid_personal_document');return BigInt(v).toString();}
export function parsePdfStatement(v:unknown):PdfStatement{
 const r=object(v);if(Object.keys(r).sort().join(',')!=='bank,closing_cents,complete,currency,from,mask,opening_cents,rows,to'||r.currency!=='USD'||typeof r.complete!=='boolean'||!Array.isArray(r.rows)||r.rows.length>300)throw Error('invalid_personal_document');
 const mask=text(r.mask,4);if(mask&&!/^\d{4}$/.test(mask))throw Error('invalid_personal_document');
 const from=documentDate(r.from),to=documentDate(r.to);if(from&&to&&(from>to||(Date.parse(to)-Date.parse(from))/86400000>366))throw Error('invalid_personal_document');
 return {bank:text(r.bank,100),mask,from,to,currency:'USD',opening_cents:amount(r.opening_cents),closing_cents:amount(r.closing_cents),complete:r.complete,
 rows:r.rows.map(value=>{const row=object(value);if(Object.keys(row).sort().join(',')!=='cents,date,description')throw Error('invalid_personal_document');return {date:documentDate(row.date),description:text(row.description,300),cents:amount(row.cents)};})};
}
export function statementChecks(data:PdfStatement,mask?:string){
 const d=parsePdfStatement(data),known=d.rows.every(r=>r.date&&r.description&&r.cents!==null&&r.date>=d.from&&r.date<=d.to);
 const balanced=known&&d.opening_cents!==null&&d.closing_cents!==null?BigInt(d.opening_cents)+d.rows.reduce((n,r)=>n+BigInt(r.cents!),0n)===BigInt(d.closing_cents):null;
 return {complete:d.complete&&known&&!!d.from&&!!d.to,balanced,wrongAccount:!!mask&&!!d.mask&&mask!==d.mask};
}
