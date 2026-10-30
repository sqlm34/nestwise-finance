import {useCallback,useSyncExternalStore} from 'react';

const refreshed=new Map<string,number>();
const listeners=new Set<()=>void>();
const key=(workspace:string,account:string)=>`${workspace}/${account}`;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const serverSnapshot=()=>null;

/** Record only after an authorized financial response has been parsed successfully. */
export function recordDataRefresh(workspace:string,account:string){
  const scope=key(workspace,account);
  refreshed.delete(scope);refreshed.set(scope,Date.now());
  if(refreshed.size>20)refreshed.delete(refreshed.keys().next().value!);
  listeners.forEach(listener=>listener());
}
export function useLastDataRefresh(workspace:string,account:string){
  const snapshot=useCallback(()=>refreshed.get(key(workspace,account))??null,[workspace,account]);
  return useSyncExternalStore(subscribe,snapshot,serverSnapshot);
}
