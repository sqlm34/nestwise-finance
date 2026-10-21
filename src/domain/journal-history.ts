import {journalCodes,parseJournal,type JournalPage} from './journal';
import {defaultJournalFilters,filterJournal,type JournalFilters} from './journal-filters';

export type HistoryPage=JournalPage&{next_cursor:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateHistoryFilters(filters:JournalFilters):string|null {
  const dates=filterJournal([],filters).error;
  if(dates)return dates;
  if(filters.query.trim().length>128||/[\u0000-\u001f\u007f]/.test(filters.query))return 'invalidQuery';
  if(filters.code!=='all'&&!journalCodes.includes(filters.code))return 'invalidFilters';
  if(!['newest','oldest'].includes(filters.order))return 'invalidFilters';
  if(filters.basis!==undefined&&!['event','paid'].includes(filters.basis))return 'invalidFilters';
  return null;
}
export function historyParams(filters:JournalFilters,cursor:string|null=null):string {
  if(validateHistoryFilters(filters)||cursor!==null&&!uuid.test(cursor))throw new Error('invalid_filters');
  const params=new URLSearchParams();
  if(filters.query.trim())params.set('q',filters.query.trim());
  if(filters.from)params.set('from',filters.from);
  if(filters.to)params.set('to',filters.to);
  if(filters.code!=='all')params.set('code',filters.code);
  if(filters.order!=='newest')params.set('order',filters.order);
  if(filters.basis==='paid')params.set('basis','paid');
  if(cursor)params.set('cursor',cursor);
  return params.size?`?${params}`:'';
}
export function parseHistoryParams(params:URLSearchParams):{filters:JournalFilters;cursor:string|null} {
  const allowed=new Set(['q','from','to','code','order','cursor','basis']);
  for(const key of params.keys())if(!allowed.has(key)||params.getAll(key).length!==1)throw new Error('invalid_filters');
  const filters:JournalFilters={query:params.get('q')??'',from:params.get('from')??'',to:params.get('to')??'',
    code:(params.get('code')??defaultJournalFilters.code) as JournalFilters['code'],
    order:(params.get('order')??defaultJournalFilters.order) as JournalFilters['order'],
    ...(params.has('basis')?{basis:params.get('basis') as JournalFilters['basis']}:{})};
  const cursor=params.get('cursor');
  historyParams(filters,cursor);
  return {filters:{...filters,query:filters.query.trim()},cursor};
}
export function parseHistoryPage(value:unknown):HistoryPage {
  const page=parseJournal(value);
  const cursor=(value as Record<string,unknown>).next_cursor;
  if(cursor!==null&&(typeof cursor!=='string'||!uuid.test(cursor)||page.entries.length!==100
    ||cursor!==page.entries.at(-1)?.id))throw new Error('invalid_journal');
  return {...page,next_cursor:cursor as string|null};
}
