import {journalCodes,type JournalCode} from './journal';
export type Period={from:string;to:string};
export type PeriodSummary=Period & {transaction_count:string;missing_paid_date:string;totals:Record<JournalCode,string>};
export type PeriodInsights={currency:'USD';generated_at:string;current:PeriodSummary;previous:PeriodSummary;months:PeriodSummary[];attention:{waiting:string;needs_review:string}};
const dayMs=86400000;
function day(value:string){const result=new Date(`${value}T00:00:00Z`);if(!/^\d{4}-\d\d-\d\d$/.test(value)||!Number.isFinite(+result)||result.toISOString().slice(0,10)!==value)throw new Error('invalid_filters');return result;}
const iso=(date:Date)=>date.toISOString().slice(0,10);
export function validatePeriod(period:Period):void{
  const from=day(period.from),to=day(period.to);
  if(period.from<'0002-01-01'||period.to>'9998-12-31'||+from>+to||(+to-+from)/dayMs>365)throw new Error('invalid_filters');
}
export function previousPeriod(period:Period):Period{
  validatePeriod(period);const from=day(period.from),to=day(period.to);
  return {from:iso(new Date(+from-(+to-+from+dayMs))),to:iso(new Date(+from-dayMs))};
}
export function periodPreset(kind:'month'|'quarter'|'year',now=new Date()):Period{
  const start=new Date(now);start.setUTCHours(0,0,0,0);start.setUTCDate(1);
  if(kind==='year')start.setUTCMonth(0);if(kind==='quarter')start.setUTCMonth(Math.floor(start.getUTCMonth()/3)*3);
  const end=new Date(start);end.setUTCMonth(end.getUTCMonth()+(kind==='year'?12:kind==='quarter'?3:1));end.setUTCDate(0);
  return {from:iso(start),to:iso(end)};
}
export function parsePeriodParams(params:URLSearchParams):Period{
  if(params.size!==2||params.getAll('from').length!==1||params.getAll('to').length!==1)throw new Error('invalid_filters');
  const period={from:params.get('from')!,to:params.get('to')!};validatePeriod(period);return period;
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_insights');return value as Record<string,unknown>;}
function integer(value:unknown,signed=false):string{
  if(typeof value!=='string'||value.length>40||!(signed?/^-?(0|[1-9][0-9]*)$/:/^(0|[1-9][0-9]*)$/).test(value))throw new Error('invalid_insights');return value;
}
function summary(value:unknown):PeriodSummary{
  const row=object(value);if(typeof row.from!=='string'||typeof row.to!=='string')throw new Error('invalid_insights');
  day(row.from);day(row.to);if(row.from>row.to)throw new Error('invalid_insights');
  const rawTotals=object(row.totals),totals={} as PeriodSummary['totals'];
  for(const code of journalCodes)totals[code]=integer(rawTotals[code],true);
  if(Object.keys(rawTotals).length!==6||journalCodes.reduce((total,code)=>total+BigInt(totals[code]),0n)!==0n)throw new Error('invalid_insights');
  const count=integer(row.transaction_count),missing=integer(row.missing_paid_date);
  if(BigInt(missing)>BigInt(count)||(count==='0'&&journalCodes.some(code=>BigInt(totals[code])!==0n)))throw new Error('invalid_insights');
  return {from:row.from,to:row.to,transaction_count:count,missing_paid_date:missing,totals};
}
export function parsePeriodInsights(value:unknown,expected:Period):PeriodInsights{
  validatePeriod(expected);const row=object(value),current=summary(row.current),previous=summary(row.previous),prior=previousPeriod(expected);
  if(row.currency!=='USD'||current.from!==expected.from||current.to!==expected.to||previous.from!==prior.from||previous.to!==prior.to
    ||typeof row.generated_at!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(row.generated_at)||!Number.isFinite(Date.parse(row.generated_at))
    ||!Array.isArray(row.months)||row.months.length<1||row.months.length>13)throw new Error('invalid_insights');
  const months=row.months.map(summary);let next=expected.from;
  for(const month of months){
    const end=day(month.from);end.setUTCDate(1);end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
    if(month.from!==next||month.to!==(iso(end)<expected.to?iso(end):expected.to))throw new Error('invalid_insights');
    next=iso(new Date(+day(month.to)+dayMs));
  }
  if(months.at(-1)?.to!==expected.to||months.reduce((n,m)=>n+BigInt(m.transaction_count),0n)!==BigInt(current.transaction_count)
    ||months.reduce((n,m)=>n+BigInt(m.missing_paid_date),0n)!==BigInt(current.missing_paid_date)
    ||journalCodes.some(code=>months.reduce((n,m)=>n+BigInt(m.totals[code]),0n)!==BigInt(current.totals[code])))throw new Error('invalid_insights');
  const attention=object(row.attention);
  return {currency:'USD',generated_at:row.generated_at,current,previous,months,attention:{waiting:integer(attention.waiting),needs_review:integer(attention.needs_review)}};
}
export const metricKeys=['receipts','refunds','net_receipts','parts_cost','fees','recorded_difference','clearing','parts_payable'] as const;
export type Metric=typeof metricKeys[number];
export function periodMetrics(period:PeriodSummary):Record<Metric,bigint>{
  const t=period.totals,receipts=-BigInt(t.receipts),refunds=BigInt(t.refunds),parts=BigInt(t.parts_cost),fees=BigInt(t.fees);
  return {receipts,refunds,net_receipts:receipts-refunds,parts_cost:parts,fees,recorded_difference:receipts-refunds-parts-fees,clearing:BigInt(t.clearing),parts_payable:-BigInt(t.parts_payable)};
}
export function insightMoney(cents:bigint,locale:'en'|'ru'):string{
  const absolute=cents<0n?-cents:cents;
  return `${cents<0n?'−':''}${new Intl.NumberFormat(locale==='ru'?'ru-RU':'en-US',{maximumFractionDigits:0}).format(absolute/100n)}${locale==='ru'?',':'.'}${(absolute%100n).toString().padStart(2,'0')} USD`;
}
