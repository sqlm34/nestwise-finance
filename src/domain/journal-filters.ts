import type {JournalCode,JournalTransaction} from './journal';

export type JournalFilters={
  query:string;from:string;to:string;code:JournalCode|'all';order:'newest'|'oldest';
};
export const defaultJournalFilters:JournalFilters={query:'',from:'',to:'',code:'all',order:'newest'};

function validDay(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000-'))return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
// Filters only the authorized page already in memory; never infers totals or completeness.
export function filterJournal(entries:JournalTransaction[],filters:JournalFilters):{
  entries:JournalTransaction[];error:'invalidDate'|'reversedRange'|null;
} {
  if((filters.from&&!validDay(filters.from))||(filters.to&&!validDay(filters.to)))
    return {entries:[],error:'invalidDate'};
  if(filters.from&&filters.to&&filters.from>filters.to)return {entries:[],error:'reversedRange'};
  const query=filters.query.trim().toLowerCase();
  const result=entries.filter(row=>{
    const day=new Date(row.occurred_at).toISOString().slice(0,10);
    return (!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to)
      &&(filters.code==='all'||row.entries.some(line=>line.code===filters.code))
      &&(!query||[row.id,row.source_order_id,row.source_event_id].some(id=>id.toLowerCase().includes(query)));
  });
  result.sort((a,b)=>{
    const time=Date.parse(a.occurred_at)-Date.parse(b.occurred_at);
    const tie=a.id<b.id?-1:a.id>b.id?1:0;
    return (filters.order==='oldest'?1:-1)*(time||tie);
  });
  // Keep every balanced transaction intact even when matching a single accounting code.
  return {entries:result,error:null};
}
