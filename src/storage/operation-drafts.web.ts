import {parseDraft,scopeKey,transitionDraft,type DraftStore,type DraftScope,type DraftAction} from '../domain/operation-draft';
// IndexedDB transactions serialize competing tabs. No credentials or cached ACLs are stored.
// Drafts are local browser data, accessible to this origin, and require live login in the UI.
function transact(scope:DraftScope,action?:DraftAction):ReturnType<DraftStore['read']>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('nestwise-operation-drafts',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('drafts');
  request.onerror=()=>reject(new Error('draft_storage_unavailable'));
  request.onblocked=()=>reject(new Error('draft_storage_blocked'));
  request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('drafts',action?'readwrite':'readonly'),store=tx.objectStore('drafts'),key=scopeKey(scope);
   let result:Awaited<ReturnType<DraftStore['read']>>=null;
   let failure:unknown;
   const read=store.get(key);
   read.onsuccess=()=>{try{
    const raw=read.result===undefined?null:read.result;
    if(raw!==null&&typeof raw!=='string')throw new Error('draft_corrupt');
    const next=action?transitionDraft(raw,scope,action):raw;
    result=parseDraft(next,scope);
    if(action){if(next===null)store.delete(key);else store.put(next,key);}
   }catch(error){failure=error;tx.abort();}};
   tx.oncomplete=()=>{db.close();resolve(result);};
   tx.onabort=()=>{db.close();reject(failure||new Error('draft_storage_unavailable'));};
   tx.onerror=()=>{failure??=new Error('draft_storage_unavailable');};
  };
 });
}
export const operationDraftStore:DraftStore={read:scope=>transact(scope),change:(scope,action)=>transact(scope,action)};
