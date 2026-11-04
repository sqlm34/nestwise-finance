import type {Access,Selection} from './live-navigation';
export type ReceiptCardRoute={last4:string;workspace:string;account:string};
export function receiptCardTarget(raw:string|undefined,last4:string|null|undefined,spaces:Access['workspaces']):Selection|null{
 if(!raw||!last4)return null;
 const routes:ReceiptCardRoute[]=JSON.parse(raw);
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
 if(!Array.isArray(routes)||routes.length>100||routes.some(r=>!r||!/^\d{4}$/.test(r.last4)||!uuid.test(r.workspace)||!uuid.test(r.account)))throw Error('receipt_routes_invalid');
 const matches=routes.filter(r=>r.last4===last4).flatMap(r=>{
  const space=spaces.find(s=>s.id===r.workspace&&['owner','accountant'].includes(s.role));
  const account=space?.accounts.find(a=>a.id===r.account&&a.currency==='USD');
  return space&&account?[{workspace:space.id,account:account.id,name:account.name,currency:account.currency}]:[];
 });
 return matches.length===1?matches[0]:null;
}
