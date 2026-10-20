import {parseHistoryPage} from './journal-history';
import {type JournalTransaction} from './journal';
import {validatePeriod,type Period} from './period-insights';
import {type BankRow} from './statement';

export const cashKinds=['job.payment_recorded','job.customer_refund_issued','job.part_cost_recorded','job.supplier_credit_received','job.processor_fee_recorded','job.processor_fee_refunded'] as const;
export type Candidate=JournalTransaction & {kind:string};
export type DraftGroup={rows:number[];transactions:string[];cents:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function candidateParams(params:URLSearchParams){
  if([...params.keys()].some(key=>!['from','to','cursor'].includes(key))||[...params.keys()].some(key=>params.getAll(key).length!==1))throw new Error('invalid_filters');
  const period={from:params.get('from')||'',to:params.get('to')||''};validatePeriod(period);
  const cursor=params.get('cursor');if(cursor!==null&&!uuid.test(cursor))throw new Error('invalid_filters');
  return {...period,cursor};
}
export function parseCandidates(value:unknown,period:Period){
  validatePeriod(period);const page=parseHistoryPage(value);
  const raw=(value as {entries:{kind?:unknown}[]}).entries;
  const entries=page.entries.map((entry,index)=>{
    const kind=raw[index].kind;
    if(typeof kind!=='string'||!cashKinds.includes(kind as typeof cashKinds[number])||!entry.paid_at||cashAmount(entry)===0n)throw new Error('invalid_candidates');
    const date=new Date(entry.paid_at).toISOString().slice(0,10);
    if(date<period.from||date>period.to)throw new Error('invalid_candidates');
    return {...entry,kind};
  });
  return {...page,entries};
}
export function cashAmount(transaction:JournalTransaction){return transaction.entries.reduce((sum,line)=>sum+(line.code==='clearing'?BigInt(line.cents):0n),0n);}
export function bankAmount(rows:BankRow[]){return rows.reduce((sum,row)=>sum+BigInt(row.amountCents),0n);}
export function bankWindow(rows:BankRow[]):Period{
  if(rows.length<1||rows.length>20)throw new Error('invalid_selection');
  const dates=rows.map(row=>row.date).sort();
  const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const period={from:shift(dates[0],-7),to:shift(dates.at(-1)!,7)};validatePeriod(period);return period;
}
export function eligibleBankRows(rows:BankRow[]):Set<number>{
  // Flag every copy, including the first occurrence of a repeated row.
  const key=(row:BankRow)=>JSON.stringify([row.date,row.description.trim().toLowerCase(),row.amountCents]);
  const counts=new Map<string,number>();for(const row of rows)counts.set(key(row),(counts.get(key(row))||0)+1);
  return new Set(rows.filter(row=>row.issues.length===0&&row.amountCents!==0&&counts.get(key(row))===1).map(row=>row.line));
}
function near(rows:BankRow[],candidate:Candidate){
  const paid=Date.parse(candidate.paid_at!);
  return rows.some(row=>Math.abs(Date.parse(new Date(paid).toISOString().slice(0,10)+'T00:00:00Z')-Date.parse(row.date+'T00:00:00Z'))<=7*86400000);
}
export function createDraft(rows:BankRow[],selected:number[],candidates:Candidate[],ids:string[],groups:DraftGroup[]):DraftGroup{
  if(!selected.length||selected.length>20||!ids.length||ids.length>20||new Set(selected).size!==selected.length||new Set(ids).size!==ids.length)throw new Error('invalid_selection');
  const eligible=eligibleBankRows(rows),bank=rows.filter(row=>selected.includes(row.line)),journal=candidates.filter(row=>ids.includes(row.id));
  if(bank.length!==selected.length||journal.length!==ids.length||selected.some(id=>!eligible.has(id))
    ||groups.some(group=>group.rows.some(id=>selected.includes(id))||group.transactions.some(id=>ids.includes(id))))throw new Error('already_used_or_invalid');
  if(journal.some(row=>!row.paid_at||!cashKinds.includes(row.kind as typeof cashKinds[number])||!near(bank,row)))throw new Error('invalid_candidate');
  const amount=bankAmount(bank);
  if(amount===0n||amount!==journal.reduce((sum,row)=>sum+cashAmount(row),0n))throw new Error('amount_mismatch');
  return {rows:[...selected],transactions:[...ids],cents:amount.toString()};
}
export function suggestGroups(rows:BankRow[],candidates:Candidate[],used:Set<string>):{groups:string[][];limited:boolean}{
  const amount=bankAmount(rows),all=candidates.filter(row=>!used.has(row.id)&&near(rows,row)&&cashAmount(row)!==0n);
  const pool=all.slice(0,60),groups:string[][]=[];
  if(amount===0n)return {groups,limited:all.length>60};
  const add=(items:Candidate[])=>{if(groups.length<10&&items.reduce((sum,row)=>sum+cashAmount(row),0n)===amount)groups.push(items.map(row=>row.id));};
  for(let i=0;i<pool.length;i++){
    add([pool[i]]);
    for(let j=i+1;j<pool.length;j++){
      add([pool[i],pool[j]]);
      for(let k=j+1;k<pool.length;k++)add([pool[i],pool[j],pool[k]]);
    }
  }
  return {groups,limited:all.length>60||groups.length===10};
}
export const reconciliationSample='Posting Date,Description,Amount\n10/11/2026,DEMO-126 customer payment,350.00\n10/12/2026,DEMO-126 supplier payment,-95.00\n10/14/2026,DEMO-126 customer refund,-100.00\n10/15/2026,DEMO-126 supplier credit,25.00\n10/18/2026,DEMO unmatched bank fee,-3.00';
