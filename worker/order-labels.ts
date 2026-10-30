import {sha256,type ServiceKey,limitedText} from './security';
import type {UserEnv} from './user-api';
type Row={source_order_id:string;source_event_id:string;customer_name?:string};
// Enrichment only: amounts, event bytes and the immutable ledger are unchanged.
export async function orderLabels<T>(page:T,connections:unknown,env:UserEnv,fetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init)):Promise<T> {
  if(!page||typeof page!=='object'||!('entries' in page)||!Array.isArray(page.entries))return page;
  const rows=page.entries as Row[];
  const requested=rows.filter(r=>!r.source_order_id.startsWith('manual:')).map(r=>({order_id:r.source_order_id,event_id:r.source_event_id}));
  if(!requested.length||requested.length>100||env.ENVIRONMENT!=='production'||env.FINANCIAL_INGESTION_ENABLED!=='true')return page;
  if(!Array.isArray(connections)||!connections.some(c=>c?.id==='alex-crm-production'&&c.enabled===true))return page;
  try {
    const now=Math.floor(Date.now()/1000),keys=JSON.parse(env.CRM_SERVICE_KEYS??'{}') as Record<string,ServiceKey>;
    const found=Object.entries(keys).find(([,k])=>k.connectionId==='alex-crm-production'&&now>=k.notBefore&&now<k.expiresAt&&/^(?:[a-f0-9]{2}){32,64}$/.test(k.secret));
    if(!found)return page;
    const [keyId,key]=found,raw=JSON.stringify(requested),timestamp=String(now),path='/api/nestwise/order-labels';
    const canonical=['nestwise-order-labels-v1','POST',path,key.connectionId,keyId,timestamp,await sha256(raw)].join('\n');
    const cryptoKey=await crypto.subtle.importKey('raw',Uint8Array.from(key.secret.match(/../g)!,h=>parseInt(h,16)),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,new TextEncoder().encode(canonical))),n=>n.toString(16).padStart(2,'0')).join('');
    const transport=env.CRM_LABEL_SOURCE?(input:string,init:RequestInit)=>env.CRM_LABEL_SOURCE!.fetch(input,init):fetcher;
    const result=await transport('https://alex-crm-api.alexeasyrepair.workers.dev'+path,{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{'content-type':'application/json','x-nw-connection':key.connectionId,'x-nw-key-id':keyId,'x-nw-timestamp':timestamp,'x-nw-signature':signature},body:raw});
    if(!result.ok){console.warn('CRM labels unavailable',result.status);return page;}
    const data=JSON.parse(await limitedText(result,100000));
    if(!Array.isArray(data.labels)||data.labels.length>100)return page;
    const names=new Map<string,string>();
    for(const label of data.labels){if(typeof label?.order_id!=='string'||typeof label.customer_name!=='string'||label.customer_name.length>200)return page;names.set(label.order_id,label.customer_name.trim());}
    return {...page,entries:rows.map(row=>({...row,...(names.get(row.source_order_id)?{customer_name:names.get(row.source_order_id)}:{})}))};
  }catch{return page;}
}
