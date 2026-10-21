import {canonicalManualOperation,parseManualOperation,type ManualOperation} from './manual-operation';
export type DraftScope={origin:string;user:string;workspace:string;account:string};
export type OperationDraft={version:1;scope:DraftScope;phase:'prepared'|'pending'|'confirmed'|'rejected';operation:ManualOperation;updated:string};
export type DraftAction={type:'prepare';operation:ManualOperation}|{type:'pending'|'confirmed'|'rejected'|'discard';operation:ManualOperation};
export function scopeKey(scope:DraftScope){return JSON.stringify([scope.origin,scope.user,scope.workspace,scope.account]);}
export function parseDraft(raw:string|null,scope:DraftScope):OperationDraft|null{
 if(raw===null)return null;
 const row=JSON.parse(raw) as OperationDraft;
 if(!row||row.version!==1||scopeKey(row.scope)!==scopeKey(scope)||!['prepared','pending','confirmed','rejected'].includes(row.phase)||!Number.isFinite(Date.parse(row.updated)))throw new Error('draft_corrupt');
 return {...row,operation:parseManualOperation(row.operation)};
}
/** Atomic storage transition. Pending commands may never be edited or discarded. */
export function transitionDraft(raw:string|null,scope:DraftScope,action:DraftAction):string|null{
 const current=parseDraft(raw,scope),operation=parseManualOperation(action.operation);
 const same=current&&canonicalManualOperation(current.operation)===canonicalManualOperation(operation);
 if(action.type==='prepare'){
  if(current){if(same)return raw;throw new Error('draft_exists');}
 }else{
  if(!same)throw new Error('draft_changed');
  if(action.type==='discard'){
   if(current!.phase==='pending')throw new Error('draft_pending');
   return null;
  }
  if(action.type==='pending'&&current!.phase==='confirmed')throw new Error('draft_confirmed');
  if((action.type==='confirmed'||action.type==='rejected')&&current!.phase!=='pending'&&current!.phase!==action.type)throw new Error('draft_not_sent');
 }
 return JSON.stringify({version:1,scope,phase:action.type==='prepare'?'prepared':action.type,operation,updated:new Date().toISOString()});
}
export interface DraftStore{read(scope:DraftScope):Promise<OperationDraft|null>;change(scope:DraftScope,action:DraftAction):Promise<OperationDraft|null>}
/** Persist before network I/O; a lost response deliberately leaves the same immutable command. */
export class DraftRejected extends Error {}
export async function submitDraft(store:DraftStore,scope:DraftScope,operation:ManualOperation,authorize:()=>Promise<void>,send:(operation:ManualOperation)=>Promise<void>){
 await authorize();
 await store.change(scope,{type:'pending',operation});
 try{await send(operation);}catch(error){
  if(error instanceof DraftRejected)await store.change(scope,{type:'rejected',operation});
  throw error;
 }
 return store.change(scope,{type:'confirmed',operation});
}
