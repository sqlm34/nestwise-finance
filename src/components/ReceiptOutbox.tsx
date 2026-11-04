import React,{useEffect,useRef,useState} from 'react';
import {AppState,Text,View} from 'react-native';
import {authenticatedFetch,authenticatedUpload} from '../auth/client';
import {deliverQueuedReceipt,type QueuedReceipt} from '../domain/receipt-queue';
import {receiptQueueStore} from '../storage/receipt-queue';
import type {DraftScope} from '../domain/operation-draft';
import {Button,Notice,styles} from './ui';
export function ReceiptOutbox({scope,ru,revision,disabled,onDelivered,onSessionExpired}:{scope:DraftScope;ru:boolean;revision:number;disabled:boolean;onDelivered:()=>void;onSessionExpired:()=>void}){
 const [rows,setRows]=useState<QueuedReceipt[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 useEffect(()=>{let active=true;void receiptQueueStore.list(scope).then(v=>{if(active)setRows(v);}).catch(()=>{if(active)setError(ru?'Не удалось прочитать сохранённые на устройстве чеки.':'Could not read receipts saved on this device.');});return()=>{active=false;};},[scope,revision,ru]);
 useEffect(()=>{let active=true;
  async function sync(){if(lock.current||disabled||AppState.currentState==='background')return;lock.current=true;
   try{const pending=await receiptQueueStore.list(scope);if(!pending.length)return;if(active)setBusy(true);
    for(const row of pending){if(!active)return;
     await deliverQueuedReceipt(row,async file=>{
      const path=`/v1/user/workspaces/${scope.workspace}/accounts/${scope.account}/receipts/${file.hash}`;
      const uploaded=await authenticatedUpload(path+'/original',file.bytes,'application/octet-stream');
      if(uploaded.status===401){onSessionExpired();throw Error();}if(!uploaded.ok)throw Error();
      const response=await authenticatedFetch(path);if(!response.ok)throw Error();
      const saved=await response.json();return saved.find((r:{hash:string})=>r.hash===file.hash)??{};
     },receiptQueueStore);
    }
    if(active){setRows(await receiptQueueStore.list(scope));setError('');onDelivered();}
   }catch{if(active)setError(ru?'Чеки остаются на устройстве. Отправка повторится при восстановлении связи, пока раздел открыт.':'Receipts remain on this device. Upload retries when connectivity returns while this section is open.');}
   finally{lock.current=false;if(active)setBusy(false);}
  }
  void sync();const timer=setInterval(()=>void sync(),30_000);const sub=AppState.addEventListener('change',state=>{if(state==='active')void sync();});
  return()=>{active=false;clearInterval(timer);sub.remove();};
 },[scope,revision,disabled,onDelivered,onSessionExpired,ru]);
 if(!rows.length&&!error)return null;
 return <View style={{gap:8}}><Text style={styles.h2}>{ru?'Сохранено на этом устройстве':'Saved on this device'}: {rows.length}</Text>
  <Notice text={ru?'Оригиналы ожидают подтверждения сервера. После загрузки откройте чек для распознавания или ручного ввода. Расход автоматически не создаётся.':'Originals await server confirmation. After upload, open a receipt for recognition or manual entry. No expense is created automatically.'}/>
  {rows.map(row=><Text key={row.hash} style={styles.text}>{row.name}</Text>)}
  {!!error&&<Notice text={error}/>}{busy&&<Text style={styles.muted}>{ru?'Отправляем…':'Uploading…'}</Text>}
  <Button label={ru?'Обновить очередь':'Refresh queue'} disabled={busy||disabled} onPress={onDelivered}/>
 </View>;
}
