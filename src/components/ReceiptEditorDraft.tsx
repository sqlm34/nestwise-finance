import React,{useEffect,useRef,useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {View} from 'react-native';
import {scopeKey,type DraftScope} from '../domain/operation-draft';
import {parseReceipt,type ReceiptData} from '../domain/receipt';
import {Button,Notice} from './ui';
export type ReceiptEditorSnapshot={form:ReceiptData;money:Record<string,string>;items:{description:string;amount:string;key:string}[];pending:{mode:'review'|'post';body:unknown;summary?:string}|null};
type Saved={revision:number;snapshot:ReceiptEditorSnapshot};
let writes:Promise<unknown>=Promise.resolve();
function persist(key:string,value:string|null){const result=writes.then(()=>value===null?AsyncStorage.removeItem(key):AsyncStorage.setItem(key,value));writes=result.catch(()=>{});return result;}
export function clearReceiptEditorDraft(scope:DraftScope,hash:string){return persist('nestwise.receipt-editor.v1:'+scopeKey(scope)+':'+hash,null);}
function decode(raw:string):Saved{
 const saved=JSON.parse(raw) as Saved,s=saved.snapshot;parseReceipt({...s.form,date:'',card_last4:null});
 if(typeof s.form.date!=='string'||s.form.date.length>100||s.form.card_last4!==undefined&&s.form.card_last4!==null&&(typeof s.form.card_last4!=='string'||s.form.card_last4.length>4))throw Error('invalid_draft');
 if(!Number.isInteger(saved.revision)||!s.money||Object.values(s.money).some(v=>typeof v!=='string'||v.length>100)||!Array.isArray(s.items)||s.items.length>100||s.items.some(i=>typeof i.key!=='string'||typeof i.description!=='string'||i.description.length>300||typeof i.amount!=='string'||i.amount.length>100)||s.pending&& !['review','post'].includes(s.pending.mode))throw Error('invalid_draft');
 return saved;
}
export function ReceiptEditorDraft({scope,hash,revision,snapshot,dirty,ru,onRestore}:{scope:DraftScope;hash:string;revision:number;snapshot:ReceiptEditorSnapshot;dirty:boolean;ru:boolean;onRestore:(value:ReceiptEditorSnapshot)=>void}){
 const key='nestwise.receipt-editor.v1:'+scopeKey(scope)+':'+hash;
 const serialized=JSON.stringify({revision,snapshot});
 const [ready,setReady]=useState(false),[recovery,setRecovery]=useState<Saved|null>(null),[error,setError]=useState(false),[saved,setSaved]=useState('');const generation=useRef(0);
 useEffect(()=>{let active=true;void writes.then(()=>AsyncStorage.getItem(key)).then(raw=>{if(active){if(raw)setRecovery(decode(raw));setReady(true);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};},[key]);
 useEffect(()=>{if(!ready||recovery)return;let active=true;const current=++generation.current;
  void persist(key,dirty?serialized:null).then(()=>{if(active&&generation.current===current){setSaved(dirty?serialized:'');setError(false);}}).catch(()=>{if(active)setError(true);});return()=>{active=false;};
 },[key,ready,recovery,serialized,dirty]);
 return <View style={{gap:8}}>
  {error&&<Notice error text={ru?'Черновик не удалось сохранить или прочитать на устройстве. Не закрывайте редактор, пока не сохраните данные на сервере.':'Could not save or read the local draft. Keep the editor open until you save to the server.'}/>}
  {recovery&&<><Notice text={recovery.revision===revision?(ru?'На устройстве остался несохранённый черновик этого чека. Восстановить его?':'An unsaved draft of this receipt is on this device. Restore it?'):(ru?'На устройстве есть черновик более ранней версии чека. На сервере данные уже изменены; автоматическое восстановление заблокировано.':'A draft belongs to an earlier receipt version. Server data changed; automatic restoration is blocked.')}/>
   {recovery.revision===revision&&<Button label={ru?'Восстановить черновик':'Restore draft'} onPress={()=>{onRestore(recovery.snapshot);setRecovery(null);}}/>}
   <Button label={ru?'Оставить данные сервера, удалить черновик':'Keep server data and discard draft'} onPress={()=>{void persist(key,null).then(()=>setRecovery(null)).catch(()=>setError(true));}}/>
  </>}
  {!recovery&&dirty&&!error&&<Notice text={saved===serialized?(ru?'Черновик сохранён на этом устройстве.':'Draft saved on this device.'):(ru?'Сохраняем черновик на устройстве…':'Saving draft on this device…')}/>}
 </View>;
}
