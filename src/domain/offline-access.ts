import {parseAccess,type Access} from './live-navigation';
export const offlineAccessLifetime=30*24*60*60*1000;
// This snapshot permits local capture only. It is never server authorization.
export function encodeOfflineAccess(origin:string,access:Access,now=Date.now()){
 return JSON.stringify({origin,at:now,access:{...access,workspaces:access.workspaces.filter(w=>['owner','accountant'].includes(w.role))}});
}
export function decodeOfflineAccess(raw:string|null,origin:string,now=Date.now()):Access|null{
 try{if(!raw)return null;const v=JSON.parse(raw);if(v.origin!==origin||!Number.isFinite(v.at)||v.at>now||now-v.at>offlineAccessLifetime)return null;
 const access=parseAccess(v.access);if(access.workspaces.some(w=>!['owner','accountant'].includes(w.role)))return null;return access;
 }catch{return null;}
}
