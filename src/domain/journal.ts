import {exactUsd} from './exact-money';
import {localDateTime} from './local-time';
export const journalCodes=['clearing','receipts','refunds','parts_cost','parts_payable','fees','expenses','transfers'] as const;
export type JournalCode=typeof journalCodes[number];
export type JournalTransaction={
  id:string;occurred_at:string;paid_at:string|null;posted_at:string;
  source_event_id:string;source_order_id:string;
  customer_name?:string;
  entries:{code:JournalCode;cents:string}[];
};
export type JournalPage={entries:JournalTransaction[];limit:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const integer=/^-?(0|[1-9]\d*)$/;
function record(value:unknown):Record<string,unknown> {
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('invalid_journal');
  return value as Record<string,unknown>;
}
function identifier(value:unknown):string {
  if(typeof value!=='string'||!uuid.test(value))throw new Error('invalid_journal');
  return value;
}
function timestamp(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)
    ||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('invalid_journal');
  return value;
}
export function parseJournal(value:unknown):JournalPage {
  const page=record(value);
  if(page.limit!==100||!Array.isArray(page.entries)||page.entries.length>100)throw new Error('invalid_journal');
  const seen=new Set<string>();
  const entries=page.entries.map(raw=>{
    const row=record(raw),id=identifier(row.id);
    if(seen.has(id))throw new Error('invalid_journal');seen.add(id);
    if(!Array.isArray(row.entries)||row.entries.length<2||row.entries.length>64)throw new Error('invalid_journal');
    const lines=row.entries.map(rawLine=>{
      const line=record(rawLine);
      if(!journalCodes.includes(line.code as JournalCode)||typeof line.cents!=='string'
        ||!integer.test(line.cents)||line.cents.length>20)throw new Error('invalid_journal');
      const amount=BigInt(line.cents);
      if(amount < -9223372036854775808n || amount > 9223372036854775807n)throw new Error('invalid_journal');
      return {code:line.code as JournalCode,cents:line.cents};
    });
    if(lines.reduce((sum,line)=>sum+BigInt(line.cents),0n)!==0n)throw new Error('invalid_journal');
    return {id,occurred_at:timestamp(row.occurred_at),paid_at:row.paid_at===null?null:timestamp(row.paid_at),
      posted_at:timestamp(row.posted_at),source_event_id:identifier(row.source_event_id),
      source_order_id:(()=>{
        if(typeof row.source_order_id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(row.source_order_id))throw new Error('invalid_journal');
        return row.source_order_id;
      })(),...(typeof row.customer_name==='string'&&row.customer_name.trim()&&row.customer_name.length<=200?{customer_name:row.customer_name.trim()}:{}),entries:lines};
  });
  return {entries,limit:100};
}
// PostgreSQL bigint cents can exceed Number precision; never convert to floating point.
export function journalMoney(cents:string,locale:'en'|'ru',currency:string):string {
  if(!integer.test(cents)||cents.length>20||currency!=='USD')throw new Error('invalid_journal');
  return exactUsd(BigInt(cents),locale);
}
export function journalDate(value:string,locale:'en'|'ru'):string {
  timestamp(value);
  return localDateTime(value,locale);
}

