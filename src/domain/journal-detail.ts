import {parseJournal,type JournalTransaction} from './journal';
import {eventTypes} from '../../worker/contract';
export type SourceEvent={id:string;order_id:string;revision:number;kind:typeof eventTypes[number];
  status:'waiting'|'posted'|'asserted'|'needs_review';occurred_at:string;paid_at:string|null;
  received_at:string;posted_at:string|null;journal_id:string|null;reference_id:string|null};
export type JournalDetail={transaction:JournalTransaction;source:SourceEvent;reference:SourceEvent|null;
  history:SourceEvent[];next_revision:number|null;audit:{action:'applied'|'needs_review';recorded_at:string}[];audit_truncated:boolean};
export type EventDetail=Omit<JournalDetail,'transaction'> & {transaction:JournalTransaction|null;event_cursor:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_detail');
  return value as Record<string,unknown>;
}
function identifier(value:unknown):string{
  if(typeof value!=='string'||!uuid.test(value))throw new Error('invalid_detail');return value;
}
function time(value:unknown):string{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))throw new Error('invalid_detail');return value;
}
export function source(value:unknown):SourceEvent{
  const row=object(value);
  if(typeof row.order_id!=='string'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(row.order_id)
    ||!Number.isInteger(row.revision)||Number(row.revision)<1||Number(row.revision)>2147483646
    ||!eventTypes.includes(row.kind as SourceEvent['kind'])||!['waiting','posted','asserted','needs_review'].includes(String(row.status)))throw new Error('invalid_detail');
  const result={id:identifier(row.id),order_id:row.order_id,revision:Number(row.revision),kind:row.kind as SourceEvent['kind'],
    status:row.status as SourceEvent['status'],occurred_at:time(row.occurred_at),paid_at:row.paid_at===null?null:time(row.paid_at),
    received_at:time(row.received_at),posted_at:row.posted_at===null?null:time(row.posted_at),
    journal_id:row.journal_id===null?null:identifier(row.journal_id),reference_id:row.reference_id===null?null:identifier(row.reference_id)};
  if((result.status==='posted')!==(result.journal_id!==null)||((result.journal_id===null)!==(result.posted_at===null)))throw new Error('invalid_detail');
  return result;
}
export function parseJournalDetail(value:unknown,expectedTransaction:string):JournalDetail{
  const row=object(value),transaction=parseJournal({entries:[row.transaction],limit:100}).entries[0];
  const provenance=parseProvenance(row),origin=provenance.source;
  if(transaction.id!==expectedTransaction||origin.journal_id!==transaction.id||origin.id!==transaction.source_event_id
    ||origin.order_id!==transaction.source_order_id)throw new Error('invalid_detail');
  return {...provenance,transaction};
}
export function parseEventDetail(value:unknown,expectedEvent:string):EventDetail{
  const row=object(value),provenance=parseProvenance(row);
  if(identifier(row.event_cursor)!==expectedEvent)throw new Error('invalid_detail');
  if(row.transaction!==null)return {...parseJournalDetail(row,provenance.source.journal_id!),event_cursor:expectedEvent};
  if(provenance.source.journal_id!==null)throw new Error('invalid_detail');
  return {...provenance,transaction:null,event_cursor:expectedEvent};
}
function parseProvenance(row:Record<string,unknown>):Omit<JournalDetail,'transaction'>{
  const origin=source(row.source),reference=row.reference===null?null:source(row.reference);
  if(reference&&(reference.id.toLowerCase()!==origin.reference_id?.toLowerCase()
      ||reference.order_id!==origin.order_id))throw new Error('invalid_detail');
  if(!Array.isArray(row.history)||row.history.length>100||!Array.isArray(row.audit)||row.audit.length>50
    ||typeof row.audit_truncated!=='boolean')throw new Error('invalid_detail');
  const history=row.history.map(source),ids=new Set<string>();let previous=2147483647;
  for(const event of history){
    if(event.order_id!==origin.order_id||event.revision>=previous||ids.has(event.id))throw new Error('invalid_detail');
    previous=event.revision;ids.add(event.id);
  }
  if(row.next_revision!==null&&(!Number.isInteger(row.next_revision)||history.length!==100||row.next_revision!==history.at(-1)?.revision))throw new Error('invalid_detail');
  const audit=row.audit.map((value):JournalDetail['audit'][number]=>{const a=object(value);
    if(a.action!=='applied'&&a.action!=='needs_review')throw new Error('invalid_detail');
    return {action:a.action,recorded_at:time(a.recorded_at)};
  });
  return {source:origin,reference,history,next_revision:row.next_revision as number|null,audit,audit_truncated:row.audit_truncated};
}
export function detailBefore(params:URLSearchParams):number|null{
  if(!params.size)return null;
  if(params.size!==1||!params.has('before')||!/^\d{1,10}$/.test(params.get('before')!))throw new Error('invalid_filters');
  const n=Number(params.get('before'));
  if(n<1||n>2147483646)throw new Error('invalid_filters');return n;
}
