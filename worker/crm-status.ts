import {productionReady} from './production-policy';
import type {UserEnv} from './user-api';
export function crmStatus(raw:unknown,env:UserEnv,now=Math.floor(Date.now()/1000)) {
 if(!Array.isArray(raw))throw new Error('invalid_crm_status');
 const connections=raw.filter(row=>row&&typeof row.id==='string'&&row.enabled===true);
 let keys:Record<string,{connectionId:string;notBefore:number;expiresAt:number;secret:string}>={};
 try{keys=JSON.parse(env.CRM_SERVICE_KEYS??'{}');if(!keys||Array.isArray(keys)||typeof keys!=='object')keys={};}catch{/* Fail closed. */}
 const valid=connections.filter(row=>Object.values(keys).some(key=>key&&key.connectionId===row.id&&Number.isFinite(key.notBefore)&&Number.isFinite(key.expiresAt)&&now>=key.notBefore&&now<key.expiresAt&&typeof key.secret==='string'&&/^[0-9a-f]{64,128}$/.test(key.secret)&&key.secret.length%2===0));
 const channel=env.FINANCIAL_INGESTION_ENABLED==='true'&&(['development','staging'].includes(env.ENVIRONMENT)||productionReady(env)&&env.PRODUCTION_CRM_APPROVED==='confirmed-account-mapping-v1');
 const connected=channel&&valid.length>0;
 const received=raw.map(row=>row.last_received_at).filter(value=>typeof value==='string'&&Number.isFinite(Date.parse(value))).sort();
 return {connected,reason:!channel?'disabled':connections.length===0?'not_connected':valid.length===0?'key_unavailable':'ready',last_received_at:received.at(-1)??null,checked_at:new Date(now*1000).toISOString()};
}
