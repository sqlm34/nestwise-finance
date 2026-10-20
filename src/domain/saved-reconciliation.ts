import {validatePeriod} from './period-insights';
export type EvidenceRow={line:number;date:string;cents:string;text_hash:string};
export type SaveReconciliation={id:string;file_hash:string;rows:EvidenceRow[];transactions:string[]};
export type SavedReconciliation=SaveReconciliation & {created_at:string;created_by:string;amount:string;canceled_at:string|null;canceled_by:string|null;reason:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,hash=/^[0-9a-f]{64}$/;
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_reconciliation');return value as Record<string,unknown>;}
function exact(row:Record<string,unknown>,keys:string[]){if(Object.keys(row).sort().join()!==keys.sort().join())throw new Error('invalid_reconciliation');}
export function parseSave(value:unknown):SaveReconciliation{
  const row=object(value);exact(row,['id','file_hash','rows','transactions']);
  if(typeof row.id!=='string'||!uuid.test(row.id)||typeof row.file_hash!=='string'||!hash.test(row.file_hash)
    ||!Array.isArray(row.rows)||!row.rows.length||row.rows.length>20||!Array.isArray(row.transactions)||!row.transactions.length||row.transactions.length>20)throw new Error('invalid_reconciliation');
  const rows=row.rows.map(raw=>{const item=object(raw);exact(item,['line','date','cents','text_hash']);
    if(!Number.isInteger(item.line)||(item.line as number)<2||(item.line as number)>5001||typeof item.date!=='string'||typeof item.cents!=='string'||! /^-?[1-9]\d{0,15}$/.test(item.cents)
      ||BigInt(item.cents)>9007199254740991n||BigInt(item.cents)<-9007199254740991n||typeof item.text_hash!=='string'||!hash.test(item.text_hash))throw new Error('invalid_reconciliation');
    validatePeriod({from:item.date,to:item.date});return {line:item.line as number,date:item.date,cents:item.cents,text_hash:item.text_hash};});
  const transactions=row.transactions.map(id=>{if(typeof id!=='string'||!uuid.test(id))throw new Error('invalid_reconciliation');return id.toLowerCase();}).sort();
  if(new Set(rows.map(r=>r.line)).size!==rows.length||new Set(rows.map(r=>`${r.date}:${r.cents}:${r.text_hash}`)).size!==rows.length||new Set(transactions).size!==transactions.length||rows.reduce((sum,r)=>sum+BigInt(r.cents),0n)===0n)throw new Error('invalid_reconciliation');
  rows.sort((a,b)=>a.line-b.line);validatePeriod({from:rows.map(r=>r.date).sort()[0],to:rows.map(r=>r.date).sort().at(-1)!});
  return {id:row.id.toLowerCase(),file_hash:row.file_hash,rows,transactions};
}
export const cancellationReasons=['mistake','duplicate','recheck'] as const;
export function parseCancellation(value:unknown):string{const row=object(value);exact(row,['reason']);if(!cancellationReasons.includes(row.reason as typeof cancellationReasons[number]))throw new Error('invalid_reconciliation');return row.reason as string;}
export function savedCursor(params:URLSearchParams):string|null{
  if(params.size===0)return null;if(params.size!==1||!params.has('cursor')||!uuid.test(params.get('cursor')!))throw new Error('invalid_filters');return params.get('cursor');
}
function timestamp(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value));}
export function parseSavedPage(value:unknown):{groups:SavedReconciliation[];next_cursor:string|null;can_write:boolean}{
  const page=object(value);if(!Array.isArray(page.groups)||page.groups.length>50||typeof page.can_write!=='boolean'||page.next_cursor!==null&&(typeof page.next_cursor!=='string'||!uuid.test(page.next_cursor)))throw new Error('invalid_reconciliation');
  const groups=page.groups.map(raw=>{const row=object(raw),base=parseSave({id:row.id,file_hash:row.file_hash,rows:row.rows,transactions:row.transactions});
    if(!timestamp(row.created_at)||typeof row.created_by!=='string'||!uuid.test(row.created_by)||typeof row.amount!=='string'||row.amount!==base.rows.reduce((sum,r)=>sum+BigInt(r.cents),0n).toString())throw new Error('invalid_reconciliation');
    if(row.canceled_at===null){if(row.canceled_by!==null||row.reason!==null)throw new Error('invalid_reconciliation');}
    else if(!timestamp(row.canceled_at)||typeof row.canceled_by!=='string'||!uuid.test(row.canceled_by)||!cancellationReasons.includes(row.reason as typeof cancellationReasons[number]))throw new Error('invalid_reconciliation');
    return {...base,created_at:row.created_at,created_by:row.created_by,amount:row.amount,canceled_at:row.canceled_at as string|null,canceled_by:row.canceled_by as string|null,reason:row.reason as string|null};});
  if(new Set(groups.map(g=>g.id)).size!==groups.length||page.next_cursor!==null&&(groups.length!==50||groups.at(-1)?.id!==page.next_cursor))throw new Error('invalid_reconciliation');
  return {groups,next_cursor:page.next_cursor as string|null,can_write:page.can_write};
}
