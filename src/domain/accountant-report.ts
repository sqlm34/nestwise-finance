import taxonomy from '../data/accountant-categories.json';
import {validatePeriod} from './period-insights';
export const reportCategories=taxonomy.categories;
export type Allocation={category:string;cents:string};
export type ReportLine={transaction_id:string;source_workspace:string;source_account:string;owner_link:string|null;business_cents:string|null;line:number;code:string;cents:string;report_cents:string;paid_at:string;posted_at:string;source_id:string;source_order:string;operational_allocations:unknown;evidence:string[];reconciled:boolean;mapping_revision:number;mapping:null|{id:string;revision:number;allocations:Allocation[];actor:string;created_at:string}};
export type Report={hash:string;id?:string;created_at?:string;data:{version:'accountant-working-paper-v1';form_version:string;entity:'Aksenov LLC';scope:'business';basis:'cash';status:'Accountant Review';workspace:string;account:string;account_name:string;workspace_name:string;currency:string;from:string;to:string;lines:ReportLine[];owner_expenses:{id:string;source_transaction:string;business_cents:string;reimbursed_cents:string;source_refunds:string;settlements:{id:string;transaction:string;cents:string}[]}[];boundary:{transaction_count:string;latest_posted_at:string|null};exceptions:{missing_paid_date:string;waiting:string;needs_review:string}}};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cents=/^-?(0|[1-9][0-9]{0,15})$/;
export function parseReport(value:unknown):Report{
 const fail=():never=>{throw new Error('invalid_report');};
 if(!value||typeof value!=='object')return fail();
 const r=value as Report,d=r.data;
 if(!/^[0-9a-f]{64}$/.test(r.hash)||!d||d.version!=='accountant-working-paper-v1'||d.form_version!==taxonomy.version||d.entity!=='Aksenov LLC'||d.scope!=='business'||d.status!=='Accountant Review'||d.basis!=='cash'||!uuid.test(d.workspace)||!uuid.test(d.account)||! /^[A-Z]{3}$/.test(d.currency)||typeof d.account_name!=='string'||typeof d.workspace_name!=='string'||!Array.isArray(d.lines)||d.lines.length>5000)return fail();
 validatePeriod({from:d.from,to:d.to});
 if(r.id!==undefined&&!uuid.test(r.id))return fail();
 if(!d.boundary||! /^[0-9]+$/.test(d.boundary.transaction_count)||!d.exceptions||Object.values(d.exceptions).length!==3||!Object.values(d.exceptions).every(x=>typeof x==='string'&&/^[0-9]+$/.test(x)))return fail();
 if(!Array.isArray(d.owner_expenses)||d.owner_expenses.length>1000)return fail();
 for(const l of d.owner_expenses){
  if(!l||!uuid.test(l.id)||!uuid.test(l.source_transaction)||![l.business_cents,l.reimbursed_cents,l.source_refunds].every(x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(x))||BigInt(l.business_cents)<=0n||!Array.isArray(l.settlements)||!l.settlements.every(x=>x&&uuid.test(x.id)&&uuid.test(x.transaction)&&typeof x.cents==='string'&&/^[1-9][0-9]{0,15}$/.test(x.cents)))return fail();
 }

 const keys=new Set<string>();
 for(const l of d.lines){
  if(!uuid.test(l.transaction_id)||!Number.isInteger(l.line)||l.line<1||keys.has(l.transaction_id+':'+l.line)||!['receipts','refunds','parts_cost','fees','expenses'].includes(l.code)||typeof l.cents!=='string'||!cents.test(l.cents)||BigInt(l.cents)===0n||typeof l.report_cents!=='string'||!cents.test(l.report_cents)||BigInt(l.report_cents)!==(['receipts','refunds'].includes(l.code)?-BigInt(l.cents):BigInt(l.owner_link?l.business_cents!:l.cents))||typeof l.paid_at!=='string'||!Number.isFinite(Date.parse(l.paid_at))||typeof l.source_id!=='string'||typeof l.source_order!=='string'||typeof l.reconciled!=='boolean'||!Array.isArray(l.evidence)||!l.evidence.every(x=>/^[0-9a-f]{64}$/.test(x)))return fail();
  if(!uuid.test(l.source_workspace)||!uuid.test(l.source_account)||l.owner_link&&(!uuid.test(l.owner_link)||l.code!=='expenses'||!l.business_cents||! /^[1-9][0-9]*$/.test(l.business_cents)||BigInt(l.business_cents)>BigInt(l.cents)))return fail();
  if(!Number.isInteger(l.mapping_revision)||l.mapping_revision<0||l.mapping_revision>100)return fail();
  keys.add(l.transaction_id+':'+l.line);
  if(l.mapping){if(!uuid.test(l.mapping.id)||!Number.isInteger(l.mapping.revision)||l.mapping.revision<1||l.mapping.revision!==l.mapping_revision)return fail();validateAllocations(l,l.mapping.allocations);}
 }
 return r;
}
export function validateAllocations(line:Pick<ReportLine,'report_cents'|'code'>,allocations:Allocation[]){
 if(!Array.isArray(allocations)||allocations.length<1||allocations.length>44||new Set(allocations.map(x=>x.category)).size!==allocations.length)throw new Error('invalid_allocation');
 let total=0n;
 for(const a of allocations){if(!reportCategories.some(c=>c.id===a.category)||typeof a.cents!=='string'||!cents.test(a.cents)||BigInt(a.cents)===0n||(BigInt(a.cents)>0n)!==(BigInt(line.report_cents)>0n)||(['receipts','refunds'].includes(line.code)!==(a.category==='tax_00')))throw new Error('invalid_allocation');total+=BigInt(a.cents);}
 if(total!==BigInt(line.report_cents))throw new Error('allocation_total');
}
export function reportTotals(report:Report){
 const totals=Object.fromEntries(reportCategories.map(c=>[c.id,0n]));let unmappedIncome=0n,unmappedExpense=0n,income=0n,expense=0n;
 for(const l of report.data.lines){const n=BigInt(l.report_cents),isIncome=['receipts','refunds'].includes(l.code);if(isIncome)income+=n;else expense+=n;
  if(l.mapping)for(const a of l.mapping.allocations)totals[a.category]+=BigInt(a.cents);else if(isIncome)unmappedIncome+=n;else unmappedExpense+=n;
 }
 return {totals,income,expense,unmappedIncome,unmappedExpense,unmapped:report.data.lines.filter(l=>!l.mapping).length,unreconciled:new Set(report.data.lines.filter(l=>!l.reconciled).map(l=>l.transaction_id)).size};
}
export function reportMoney(value:bigint|string){const n=BigInt(value),a=n<0n?-n:n;return `${n<0n?'-':''}${a/100n}.${String(a%100n).padStart(2,'0')}`;}
export function reportCSV(report:Report){
 const cell=(x:unknown)=>{let s=String(x??'');if(/^[=+@\t\r-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
 const rows=[['Status','Snapshot','Input SHA256','Currency','Paid at','Transaction','Line','Source','Code','Ledger cents','Report cents','Proposed category','Allocated cents','Mapping revision','Evidence SHA256','Reconciled']];
 for(const l of report.data.lines)for(const a of l.mapping?.allocations??[{category:'UNMAPPED',cents:l.report_cents}])rows.push([report.data.status,report.id??'LIVE',report.hash,report.data.currency,l.paid_at,l.transaction_id,String(l.line),l.source_order,l.code,l.cents,l.report_cents,a.category,a.cents,String(l.mapping_revision),l.evidence.join(';'),String(l.reconciled)]);
 return '\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
const escape=(x:unknown)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reportHTML(report:Report){
 const d=report.data,t=reportTotals(report),expenses=reportCategories.filter(c=>c.section==='expense');
 const category=(id:string)=>reportCategories.find(c=>c.id===id)!;
 const row=(id:string)=>`<tr><td>${escape(category(id).en)}</td><td class="amount">${reportMoney(t.totals[id])}</td></tr>`;
 const pairs=expenses.slice(0,20).map((c,i)=>`<tr><td>${escape(c.en)}</td><td class="amount">${reportMoney(t.totals[c.id])}</td><td>${escape(expenses[i+20].en)}</td><td class="amount">${reportMoney(t.totals[expenses[i+20].id])}</td></tr>`).join('');
 return `<!doctype html><html><head><meta charset="utf-8"><title>Financial Statement — preliminary</title><style>@page{size:Letter;margin:32pt}body{font:10px Arial,sans-serif;color:#193f33}h1{font-size:23px;margin:0 0 8px}h2{font-size:13px}p{line-height:1.4}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #cbd9d2;padding:5px;text-align:left;overflow-wrap:anywhere}th{background:#edf4ef}.amount{text-align:right;width:16%}.notice{background:#fff4dc;padding:9px;border:1px solid #dec990}.meta{font-size:9px;overflow-wrap:anywhere}.schedule{break-before:page;page-break-before:always}.schedule td{font-size:8px}tr{break-inside:avoid}thead{display:table-header-group}footer{font-size:8px;margin-top:10px}</style></head><body>
 <h1>FINANCIAL STATEMENT</h1><p>NESTWISE | ACCOUNTANT WORKING COPY | ${escape(d.currency)}</p><div class="notice"><b>PRELIMINARY — ACCOUNTANT REVIEW — NOT FINALIZED</b><br>Proposed classifications only. Tax policy, annual form version, inventory, mixed-use and treatment of refunds/fees require accountant approval. Zero means no proposed allocation, not absence of activity.</div>
 <p>Period: ${escape(d.from)} — ${escape(d.to)} | Cash basis, UTC payment dates<br>Company: ${escape(d.entity)}<br>Business workspace: ${escape(d.workspace_name)}<br>Account: ${escape(d.account_name)}</p>
 <table>${row('tax_00')}</table><h2>Cost of Goods:</h2><table>${['tax_01','tax_02','tax_03'].map(row).join('')}</table><h2>Expenses:</h2><table><thead><tr><th>Category</th><th class="amount">Amount</th><th>Category</th><th class="amount">Amount</th></tr></thead><tbody>${pairs}</tbody></table>
 <footer>Proposed form totals only. Unmapped income: ${reportMoney(t.unmappedIncome)}; unmapped costs: ${reportMoney(t.unmappedExpense)} ${escape(d.currency)}. Reserved for Future Use: intentionally blank.</footer>
 <section class="schedule"><h1>REVIEW AND JOURNAL LINEAGE</h1><p class="meta">Snapshot: ${escape(report.id??'LIVE PREVIEW')}<br>Input SHA-256: ${escape(report.hash)}<br>Form: ${escape(d.form_version)} | Renderer: accountant-working-paper-v1<br>Boundary: ${escape(d.boundary.transaction_count)} transactions; latest posting ${escape(d.boundary.latest_posted_at)}</p>
 <p>Recorded income after refunds: ${reportMoney(t.income)}; recorded costs: ${reportMoney(t.expense)} ${escape(d.currency)}. These are journal amounts, not approved tax totals.</p>
 <div class="notice">Unmapped lines: ${t.unmapped}; unreconciled transactions: ${t.unreconciled}; missing payment dates: ${escape(d.exceptions.missing_paid_date)}; waiting source events: ${escape(d.exceptions.waiting)}; source events requiring review: ${escape(d.exceptions.needs_review)}. Personally paid business expenses: ${d.owner_expenses.length}; source refunds requiring review: ${d.owner_expenses.filter(x=>x.source_refunds!=='0').length}. Bank period completeness and all tax policies still require review. Finalization is disabled.</div>
 <table><thead><tr><th>Paid date / source</th><th>Journal / line / original code</th><th>Proposed allocations</th><th>Evidence SHA-256</th></tr></thead><tbody>${d.lines.map(l=>`<tr><td>${escape(l.paid_at)}<br>${escape(l.source_order)}</td><td>${escape(l.transaction_id)} / ${l.line}<br>${escape(l.code)}: ${reportMoney(l.report_cents)}<br>Original ledger: ${reportMoney(l.cents)}<br>${escape(JSON.stringify(l.operational_allocations??[]))}</td><td>${l.mapping?.allocations.map(a=>`${escape(a.category)}: ${reportMoney(a.cents)}`).join('<br>')??'UNMAPPED'}<br>Revision ${l.mapping_revision}</td><td>${l.evidence.map(escape).join('<br>')||'No linked document'}<br>${l.reconciled?'Reconciled assertion':'Not reconciled'}</td></tr>`).join('')}</tbody></table></section></body></html>`;
}
