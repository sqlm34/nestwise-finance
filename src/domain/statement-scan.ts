import {isoDate,previewStatement} from './statement';
export type StatementScan={currency:'USD';bank:string;from:string;to:string;opening_cents:string|null;closing_cents:string|null;rows:{date:string;description:string;amount_cents:string|null}[]};
export function parseStatementScan(value:unknown):StatementScan{
 const v=value as StatementScan;if(!v||typeof v!=='object'||v.currency!=='USD'||typeof v.bank!=='string'||v.bank.length>100||!Array.isArray(v.rows)||v.rows.length>100)throw Error('invalid_statement_scan');
 for(const d of [v.from,v.to])if(d!==''&&isoDate(d)!==d)throw Error('invalid_statement_scan');
 if(v.from&&v.to&&v.from>v.to)throw Error('invalid_statement_scan');
 const amount=(n:unknown)=>n===null||typeof n==='string'&&/^-?(0|[1-9][0-9]{0,11})$/.test(n);
 if(!amount(v.opening_cents)||!amount(v.closing_cents))throw Error('invalid_statement_scan');
 for(const r of v.rows)if(!r||typeof r.description!=='string'||r.description.length>500||!amount(r.amount_cents)||(r.date!==''&&isoDate(r.date)!==r.date))throw Error('invalid_statement_scan');
 return {currency:'USD',bank:v.bank,from:v.from,to:v.to,opening_cents:v.opening_cents,closing_cents:v.closing_cents,rows:v.rows.map(r=>({date:r.date,description:r.description,amount_cents:r.amount_cents}))};
}
export function scanCsv(scan:StatementScan,sourceHash?:string):string{
 const amount=(s:string|null)=>{if(!s?.startsWith('d:'))return s;const v=s.slice(2);if(!/^-?\d+(\.\d{0,2})?$/.test(v))throw Error('invalid_amount');const [a,b='']=v.replace('-','').split('.');return ((BigInt(a)*100n+BigInt(b.padEnd(2,'0')))*(v.startsWith('-')?-1n:1n)).toString();};
 const v=parseStatementScan({...scan,opening_cents:amount(scan.opening_cents),closing_cents:amount(scan.closing_cents),rows:scan.rows.map(r=>({...r,amount_cents:amount(r.amount_cents)}))});if(!v.rows.length||!v.from||!v.to||v.opening_cents===null||v.closing_cents===null)throw Error('incomplete_statement');
 if(v.rows.some(r=>!r.date||r.date<v.from||r.date>v.to||!r.description.trim()||r.amount_cents===null||BigInt(r.amount_cents)===0n))throw Error('incomplete_statement');
 if(BigInt(v.opening_cents)+v.rows.reduce((s,r)=>s+BigInt(r.amount_cents!),0n)!==BigInt(v.closing_cents))throw Error('statement_balance_mismatch');
 const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
 const rows=v.rows.map(r=>{const c=BigInt(r.amount_cents!),n=c<0n?-c:c;return [r.date,quote(r.description),`${c<0n?'-':''}${n/100n}.${(n%100n).toString().padStart(2,'0')}`].join(',');});
 if(sourceHash&&!/^[a-f0-9]{64}$/.test(sourceHash))throw Error('invalid_source_hash');
 const csv='Date,Description,Amount'+(sourceHash?',Source SHA256':'')+'\n'+rows.map(r=>r+(sourceHash?','+sourceHash:'')).join('\n');const preview=previewStatement(csv,'chase','Scan');if(preview.errors.length)throw Error('invalid_statement_scan');return csv;
}
