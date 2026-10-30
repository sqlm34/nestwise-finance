const signatures=new Map<string,string>();
const listeners=new Map<string,Set<()=>void>>();
const scope=(workspace:string,account:string)=>`${workspace}/${account}`;
export function recordJournalChange(workspace:string,account:string,signature:string){
  const key=scope(workspace,account),previous=signatures.get(key);
  signatures.delete(key);signatures.set(key,signature);
  if(signatures.size>20)signatures.delete(signatures.keys().next().value!);
  if(previous!==undefined&&previous!==signature)listeners.get(key)?.forEach(listener=>listener());
}
export function subscribeJournalChanges(workspace:string,account:string,listener:()=>void){
  const key=scope(workspace,account),group=listeners.get(key)??new Set<()=>void>();
  group.add(listener);listeners.set(key,group);
  return()=>{group.delete(listener);if(!group.size)listeners.delete(key);};
}
