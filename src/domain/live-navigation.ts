export type Access={user:{id:string;name:string;email:string};workspaces:{id:string;name:string;kind?:'business'|'personal'|'family';role:string;accounts:{id:string;name:string;currency:string}[]}[]};
export type Selection={workspace:string;account:string;name:string;currency:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseAccess(value:unknown):Access{
  const fail=():never=>{throw new Error('invalid_access');};
  const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail();
  const text=(v:unknown):string=>typeof v==='string'&&v.length>0&&v.length<=512?v:fail();
  const id=(v:unknown):string=>typeof v==='string'&&uuid.test(v)?v:fail();
  const root=record(value),user=record(root.user);
  if(!Array.isArray(root.workspaces))return fail();
  const workspaces=root.workspaces.map(v=>{
    const space=record(v);
    if(!['owner','member','accountant','reviewer'].includes(String(space.role))||!Array.isArray(space.accounts))return fail();
    const accounts=space.accounts.map(v=>{const a=record(v);if(typeof a.currency!=='string'||! /^[A-Z]{3}$/.test(a.currency))return fail();return {id:id(a.id),name:text(a.name),currency:a.currency};});
    if(new Set(accounts.map(a=>a.id)).size!==accounts.length)return fail();
    if(space.kind!==undefined&&!['business','personal','family'].includes(String(space.kind)))return fail();
    return {id:id(space.id),name:text(space.name),kind:space.kind as 'business'|'personal'|'family'|undefined,role:String(space.role),accounts};
  });
  if(new Set(workspaces.map(w=>w.id)).size!==workspaces.length)return fail();
  return {user:{id:text(user.id),name:text(user.name),email:text(user.email)},workspaces};
}
export function selectionKey(user:string){return `nestwise.selection.v1:${encodeURIComponent(user)}`;}
// A remembered selection is a hint, never authority. Never substitute a different
// account when access is revoked: require an explicit selection instead.
export function resolveSelection(access:Access,stored:string|null):Selection|null{
  if(!stored)return null;
  try{
    const value=JSON.parse(stored);
    if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.workspace!=='string'||typeof value.account!=='string')return null;
    const space=access.workspaces.find(w=>w.id===value.workspace);
    const account=space?.accounts.find(a=>a.id===value.account);
    return space&&account?{workspace:space.id,account:account.id,name:account.name,currency:account.currency}:null;
  }catch{return null;}
}

// Presentation-only exclusion of the two acceptance fixtures the owner removed.
// This does not revoke server permissions or delete any financial evidence.
export function workingAccess(access:Access):Access {
 return {...access,workspaces:access.workspaces.filter(w=>w.name!=='SYNTHETIC — production OCR').map(w=>({...w,accounts:w.accounts.filter(a=>a.name!=='SYNTHETIC OCR acceptance')})).sort((a,b)=>['family','personal','business'].indexOf(a.kind??'business')-['family','personal','business'].indexOf(b.kind??'business'))};
}
