import {isoDate,type StatementPreview} from './statement';
export type StatementPeriod={from:string;to:string;opening_cents:string;closing_cents:string;last4:string;confirmed:true};
export type PeriodCheck={net_cents:string;expected_closing_cents:string;difference_cents:string;outside_rows:number[];ambiguous_rows:number[];balanced:boolean};
export type PeriodRecord={hash:string;revision:number;id:string;data:StatementPeriod;check:PeriodCheck;created_at:string};
const integer=/^(0|-?[1-9]\d{0,14})$/;
export function parsePeriodRecords(value:unknown):PeriodRecord[]{
  if(!Array.isArray(value)||value.length>100)throw new Error('invalid_statement_period');
  const seen=new Set<string>();
  for(const row of value){
    if(!row||typeof row.hash!=='string'||! /^[a-f0-9]{64}$/.test(row.hash)||typeof row.id!=='string'
      ||! /^[a-f0-9-]{36}$/i.test(row.id)||seen.has(row.id)||!Number.isInteger(row.revision)||row.revision<1||row.revision>100
      ||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at)))throw new Error('invalid_statement_period');
    parseStatementPeriod(row.data);seen.add(row.id);
    const c=row.check;
    if(!c||typeof c.balanced!=='boolean'||[c.net_cents,c.expected_closing_cents,c.difference_cents].some(n=>typeof n!=='string'||! /^(0|-?[1-9]\d{0,20})$/.test(n))
      ||[c.outside_rows,c.ambiguous_rows].some(lines=>!Array.isArray(lines)||lines.length>5000||lines.some(n=>!Number.isInteger(n)||n<2||n>5001)))throw new Error('invalid_statement_period');
  }
  return value;
}
export function parseStatementPeriod(value:unknown):StatementPeriod{
  const v=value as StatementPeriod;
  if(!v||Object.keys(v).sort().join(',')!=='closing_cents,confirmed,from,last4,opening_cents,to'||v.confirmed!==true
    ||typeof v.from!=='string'||typeof v.to!=='string'||isoDate(v.from)!==v.from||isoDate(v.to)!==v.to||v.from>v.to
    ||typeof v.last4!=='string'||!/^\d{4}$/.test(v.last4)
    ||[v.opening_cents,v.closing_cents].some(n=>typeof n!=='string'||!integer.test(n)))throw new Error('invalid_statement_period');
  return {...v};
}
export function checkStatementPeriod(preview:StatementPreview,period:StatementPeriod):PeriodCheck{
  if(preview.errors.length)throw new Error('invalid_document');
  const net=preview.rows.reduce((sum,row)=>sum+BigInt(row.amountCents),0n);
  const expected=BigInt(period.opening_cents)+net,difference=BigInt(period.closing_cents)-expected;
  const outside=preview.rows.filter(row=>row.date<period.from||row.date>period.to).map(row=>row.line);
  const ambiguous=preview.rows.filter(row=>row.issues.length>0).map(row=>row.line);
  return {net_cents:String(net),expected_closing_cents:String(expected),difference_cents:String(difference),outside_rows:outside,ambiguous_rows:ambiguous,balanced:difference===0n&&!outside.length&&!ambiguous.length};
}
// Only declared statement periods establish coverage. Transaction dates alone
// cannot prove a missing month: an account may have had no activity.
export function statementContinuity(records:PeriodRecord[]){
  const latest=new Map<string,PeriodRecord>();
  for(const row of records)if(!latest.has(row.hash)||latest.get(row.hash)!.revision<row.revision)latest.set(row.hash,row);
  const sorted=[...latest.values()].sort((a,b)=>a.data.from.localeCompare(b.data.from)||a.data.to.localeCompare(b.data.to));
  const issues:{kind:'gap'|'overlap'|'balance'|'account';left:string;right:string}[]=[];
  let frontier:PeriodRecord|undefined;
  for(const current of sorted){
    if(frontier){
      const a=frontier.data,b=current.data;
      if(a.last4!==b.last4)issues.push({kind:'account',left:frontier.hash,right:current.hash});
      if(b.from<=a.to)issues.push({kind:'overlap',left:frontier.hash,right:current.hash});
      else {
        const days=(Date.parse(b.from+'T00:00:00Z')-Date.parse(a.to+'T00:00:00Z'))/86400000;
        if(days>1)issues.push({kind:'gap',left:frontier.hash,right:current.hash});
        else if(a.last4===b.last4&&a.closing_cents!==b.opening_cents)issues.push({kind:'balance',left:frontier.hash,right:current.hash});
      }
    }
    if(!frontier||current.data.to>frontier.data.to)frontier=current;
  }
  return issues;
}
