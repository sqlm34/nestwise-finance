import {validatePeriod,type Period} from './period-insights';
export const expenseServices=[
 {id:'openai',name:'OpenAI',color:'#16866b',pattern:/\b(?:OPEN\s?AI|CHAT\s?GPT)\b/i},
 {id:'cloudflare',name:'Cloudflare',color:'#ed8c22',pattern:/\bCLOUDFLARE\b/i},
 {id:'retell',name:'Retell AI',color:'#7964d8',pattern:/\bRETELL(?:AI)?\b/i},
] as const;
export type ServiceRow={id:string;paid_on:string;name:string;cents:string;pending:boolean;currency:string};
export function monthPeriod(month:string):Period {
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid_month');
 const start=month+'-01',end=new Date(start+'T12:00:00Z');end.setUTCMonth(end.getUTCMonth()+1);end.setUTCDate(0);
 const period={from:start,to:end.toISOString().slice(0,10)};validatePeriod(period);return period;
}
export function shiftExpenseMonth(month:string,step:number):string {
 const d=new Date(monthPeriod(month).from+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+step);return d.toISOString().slice(0,7);
}
export function serviceExpenses(rows:ServiceRow[],month:string){
 const period=monthPeriod(month),seen=new Map<string,string>();
 const groups=expenseServices.map(s=>({...s,spent:0n,refunds:0n,rows:[] as ServiceRow[]}));
 let pending=0,posted=0;
 for(const row of rows){
  if(!row||typeof row.id!=='string'||!row.id||typeof row.name!=='string'||typeof row.cents!=='string'||! /^-?(0|[1-9]\d{0,19})$/.test(row.cents)||row.currency!=='USD'||typeof row.pending!=='boolean')throw Error('invalid_bank_row');
  validatePeriod({from:row.paid_on,to:row.paid_on});
  const fingerprint=JSON.stringify(row);if(seen.has(row.id)){if(seen.get(row.id)!==fingerprint)throw Error('bank_changed');continue;}seen.set(row.id,fingerprint);
  if(row.paid_on<period.from||row.paid_on>period.to)continue;
  const group=groups.find(s=>s.pattern.test(row.name));
  if(row.pending){if(group)pending++;continue;}posted++;
  if(!group)continue;const cents=BigInt(row.cents);if(cents===0n)continue;
  if(cents<0n)group.spent-=cents;else group.refunds+=cents;group.rows.push(row);
 }
 return {groups,total:groups.reduce((n,g)=>n+g.spent,0n),refunds:groups.reduce((n,g)=>n+g.refunds,0n),pending,posted};
}
export function pieSlices(values:bigint[]){
 const total=values.reduce((n,v)=>n+v,0n);let angle=-Math.PI/2;
 return values.map(value=>{if(value<=0n||total<=0n)return '';const part=Number(value*1_000_000n/total)/1_000_000;
  if(value===total)return 'M 120 20 A 100 100 0 1 1 120 220 A 100 100 0 1 1 120 20 Z';
  const start=angle;angle+=part*Math.PI*2;return `M 120 120 L ${120+100*Math.cos(start)} ${120+100*Math.sin(start)} A 100 100 0 ${part>0.5?1:0} 1 ${120+100*Math.cos(angle)} ${120+100*Math.sin(angle)} Z`;
 });
}
type Feed={connection:unknown;rows:ServiceRow[];count?:number};
// Never silently chart the 500-row page as a complete month.
export async function loadExpenseMonth(month:string,read:(period:Period)=>Promise<Feed>):Promise<Feed>{
 const period=monthPeriod(month),first=await read(period);
 if(!Array.isArray(first.rows))throw Error('invalid_bank_feed');
 if(!first.connection)return first;
 if(!Number.isSafeInteger(first.count)||first.count!<first.rows.length)throw Error('invalid_bank_feed');
 if(first.count!<=first.rows.length)return first;
 const rows:ServiceRow[]=[];
 for(let day=1;day<=Number(period.to.slice(-2));day++){
  const date=month+'-'+String(day).padStart(2,'0'),page=await read({from:date,to:date});
  if(!page.connection||!Array.isArray(page.rows)||page.count===undefined||page.count>page.rows.length)throw Error('incomplete_bank_feed');
  rows.push(...page.rows);
 }
 return {...first,rows,count:rows.length};
}
