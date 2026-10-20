import {previewStatement,type BankRow} from './statement';
import {eligibleBankRows} from './reconciliation';
import {parseSave,type SaveReconciliation} from './saved-reconciliation';
export type EvidenceStatus='matched'|'unmatched'|'blocked'|'mismatch'|'reserved';
export type ReviewRow={line:number;date:string;cents:string;status:EvidenceStatus;groups:string[]};
export type EvidenceReview={hash:string;checked_at:string;copy:'primary'|'backup';canceled:number;
  groups:{id:string;valid:boolean;rows:number[];transactions:string[]}[];rows:ReviewRow[];
  totals:Record<EvidenceStatus,{count:number;credits:string;debits:string}>};
const statuses:EvidenceStatus[]=['matched','unmatched','blocked','mismatch','reserved'];
export function evidenceTotals(rows:ReviewRow[]):EvidenceReview['totals']{
  return Object.fromEntries(statuses.map(status=>{const selected=rows.filter(row=>row.status===status);return [status,{count:selected.length,
    credits:selected.reduce((sum,row)=>sum+(BigInt(row.cents)>0n?BigInt(row.cents):0n),0n).toString(),
    debits:selected.reduce((sum,row)=>sum+(BigInt(row.cents)<0n?-BigInt(row.cents):0n),0n).toString()}];})) as EvidenceReview['totals'];
}
export async function statementFingerprints(rows:BankRow[],digest:(text:string)=>Promise<string>){
  const result=new Map<number,string>();
  for(const row of rows)result.set(row.line,`${row.date}:${row.amountCents}:${await digest(row.description.trim().toLowerCase())}`);
  return result;
}
export function reviewEvidence(text:string,hash:string,fingerprints:Map<number,string>,input:unknown,copy:'primary'|'backup',checked_at:string):EvidenceReview{
  const preview=previewStatement(text,'chase','Archive'),eligible=eligibleBankRows(preview.rows);
  if(preview.errors.length)throw new Error('invalid_document');
  const raw=input as {groups:unknown[];reserved:{fingerprint:string;group_id:string}[];canceled:number};
  if(!raw||!Array.isArray(raw.groups)||raw.groups.length>5000||!Array.isArray(raw.reserved)||raw.reserved.length>5000||!Number.isSafeInteger(raw.canceled)||raw.canceled<0)throw new Error('invalid_evidence');
  const groups:SaveReconciliation[]=raw.groups.map(parseSave),seen=new Set<string>();
  const bankByLine=new Map(preview.rows.map(row=>[row.line,row]));
  const reservedByFingerprint=new Map<string,string[]>();
  for(const item of raw.reserved){
    if(!item||typeof item.fingerprint!=='string'||typeof item.group_id!=='string'||! /^[0-9a-f-]{36}$/.test(item.group_id))throw new Error('invalid_evidence');
    reservedByFingerprint.set(item.fingerprint,[...(reservedByFingerprint.get(item.fingerprint)??[]),item.group_id]);
  }
  const valid=new Map<string,boolean>();
  for(const group of groups){
    if(group.file_hash!==hash||seen.has(group.id))throw new Error('invalid_evidence');seen.add(group.id);
    valid.set(group.id,group.rows.every(evidence=>{
      const row=bankByLine.get(evidence.line);
      return !!row&&eligible.has(row.line)&&row.date===evidence.date&&String(row.amountCents)===evidence.cents&&fingerprints.get(row.line)===`${evidence.date}:${evidence.cents}:${evidence.text_hash}`;
    }));
  }
  const rowGroups=new Map<number,string[]>();
  for(const group of groups)for(const row of group.rows)rowGroups.set(row.line,[...(rowGroups.get(row.line)??[]),group.id]);
  // Overlap is an integrity error, even if each assertion independently matches the original.
  for(const ids of rowGroups.values())if(ids.length>1)for(const id of ids)valid.set(id,false);
  const rows=preview.rows.map(row=>{
    const ids=rowGroups.get(row.line)??[];
    const reserved=reservedByFingerprint.get(fingerprints.get(row.line)??'')??[];
    const status:EvidenceStatus=ids.length?(ids.every(id=>valid.get(id))?'matched':'mismatch'):reserved.length?'reserved':eligible.has(row.line)?'unmatched':'blocked';
    return {line:row.line,date:row.date,cents:String(row.amountCents),status,groups:[...ids,...reserved]};
  });
  return {hash,checked_at,copy,canceled:raw.canceled,rows,groups:groups.map(group=>({id:group.id,valid:valid.get(group.id)!,rows:group.rows.map(row=>row.line),transactions:group.transactions})),totals:evidenceTotals(rows)};
}
export function parseEvidenceReview(value:unknown,hash:string):EvidenceReview{
  const data=value as EvidenceReview;
  if(!data||data.hash!==hash||!Number.isFinite(Date.parse(data.checked_at))||!['primary','backup'].includes(data.copy)||!Number.isSafeInteger(data.canceled)||data.canceled<0
    ||!Array.isArray(data.rows)||data.rows.length>5000||!Array.isArray(data.groups)||data.groups.length>5000)throw new Error('invalid_evidence');
  const uuid=/^[0-9a-f-]{36}$/;
  const seen=new Set<number>();
  for(const row of data.rows){
    if(!Number.isInteger(row.line)||row.line<2||row.line>5001||seen.has(row.line)||!/^\d{4}-\d\d-\d\d$/.test(row.date)
      ||! /^-?(0|[1-9]\d{0,15})$/.test(row.cents)||!statuses.includes(row.status)||!Array.isArray(row.groups)||row.groups.some(id=>typeof id!=='string'||!uuid.test(id)))throw new Error('invalid_evidence');
    seen.add(row.line);
  }
  const ids=new Set<string>();
  for(const group of data.groups){
    if(!uuid.test(group.id)||ids.has(group.id)||typeof group.valid!=='boolean'||!Array.isArray(group.rows)||!group.rows.length||group.rows.length>20||group.rows.some(line=>!Number.isInteger(line)||line<2||line>5001)
      ||!Array.isArray(group.transactions)||!group.transactions.length||group.transactions.length>20||group.transactions.some(id=>!uuid.test(id)))throw new Error('invalid_evidence');
    ids.add(group.id);
  }
  const totals=evidenceTotals(data.rows);
  for(const status of statuses)if(data.totals?.[status]?.count!==totals[status].count||data.totals[status].credits!==totals[status].credits||data.totals[status].debits!==totals[status].debits)throw new Error('invalid_evidence');
  return data;
}
