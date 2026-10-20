import {source,type SourceEvent} from './journal-detail';
export const eventStatuses=['attention','all','waiting','needs_review','posted','asserted'] as const;
export type EventStatus=typeof eventStatuses[number];
export const guidanceCodes=['none','earlier_revision','excess_refund','snapshot_mismatch','reference','review'] as const;
export type AccountEvent=SourceEvent & {cursor:string;guidance:typeof guidanceCodes[number]};
export type EventsPage={events:AccountEvent[];next_cursor:string|null;counts:Record<SourceEvent['status'],string>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseEventParams(params:URLSearchParams){
  for(const key of params.keys())if(!['status','q','cursor'].includes(key)||params.getAll(key).length!==1)throw new Error('invalid_filters');
  const status=params.get('status')??'attention',query=params.get('q')??'',cursor=params.get('cursor');
  if(!eventStatuses.includes(status as EventStatus)||query.length>128||/[\x00-\x1f\x7f]/.test(query)||cursor!==null&&!uuid.test(cursor))throw new Error('invalid_filters');
  return {status:status as EventStatus,query,cursor};
}
export function parseEventsPage(value:unknown):EventsPage{
  if(!value||typeof value!=='object')throw new Error('invalid_events');
  const row=value as Record<string,unknown>;
  if(!Array.isArray(row.events)||row.events.length>100||!row.counts||typeof row.counts!=='object')throw new Error('invalid_events');
  const ids=new Set<string>();
  const events=row.events.map((raw):AccountEvent=>{
    const event=source(raw);
    if(typeof raw.cursor!=='string'||!uuid.test(raw.cursor)||ids.has(raw.cursor)||!guidanceCodes.includes(raw.guidance))throw new Error('invalid_events');
    if(event.status==='waiting'?raw.guidance!=='earlier_revision':event.status==='needs_review'?!['excess_refund','snapshot_mismatch','reference','review'].includes(raw.guidance):raw.guidance!=='none')throw new Error('invalid_events');
    ids.add(raw.cursor);return {...event,cursor:raw.cursor,guidance:raw.guidance};
  });
  if(row.next_cursor!==null&&(events.length!==100||row.next_cursor!==events.at(-1)?.cursor))throw new Error('invalid_events');
  const counts={} as EventsPage['counts'];
  for(const status of ['waiting','needs_review','posted','asserted'] as const){
    const count=(row.counts as Record<string,unknown>)[status];
    if(typeof count!=='string'||!/^(0|[1-9][0-9]*)$/.test(count)||count.length>19)throw new Error('invalid_events');
    counts[status]=count;
  }
  return {events,next_cursor:row.next_cursor as string|null,counts};
}
