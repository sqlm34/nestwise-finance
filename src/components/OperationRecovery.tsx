import React,{useEffect,useState} from 'react';
import {Text} from 'react-native';
import {apiURL} from '../auth/client';
import {operationDraftStore} from '../storage/operation-drafts';
import type {OperationDraft} from '../domain/operation-draft';
import {useApp} from '../state';
import {Button,Card,Notice,styles} from './ui';
/** Selected-account recovery notice, never an authorization cache or background sender. */
export function OperationRecovery({user,workspace,account,onOpen}:{user:string;workspace:string;account:string;onOpen:()=>void}){
 const {locale,offline}=useApp(),ru=locale==='ru';
 const [revision,setRevision]=useState(0),[result,setResult]=useState<{draft:OperationDraft|null;failed:boolean}|null>(null);
 useEffect(()=>{let active=true;
  operationDraftStore.read({origin:apiURL,user,workspace,account}).then(draft=>{if(active)setResult({draft,failed:false});}).catch(()=>{if(active)setResult({draft:null,failed:true});});
  return()=>{active=false;};
 },[user,workspace,account,revision]);
 if(!result||(!result.draft&&!result.failed&&!offline))return null;
 return <Card><Text accessibilityRole="header" style={styles.h2}>{ru?'Требует внимания':'Needs attention'}</Text>
  {offline&&<Notice text={ru?'Нет сети. Отправка операций приостановлена; подготовленный черновик остаётся на устройстве.':'Offline. Submission is paused; a prepared draft remains on this device.'}/>}
  {result.failed?<Notice error text={ru?'Не удалось проверить локальный черновик. Не создавайте повторную запись, пока не восстановлено хранилище.':'Could not check the local draft. Restore storage before entering a replacement transaction.'}/>:result.draft&&<>
   <Notice text={result.draft.phase==='pending'?(ru?'Есть операция без подтверждения. Откройте её и повторите с тем же номером.':'An operation is awaiting confirmation. Open it and retry with the same ID.'):result.draft.phase==='rejected'?(ru?'Сервер отклонил операцию. Откройте черновик для исправления.':'Server rejected the operation. Open the draft to correct it.'):result.draft.phase==='confirmed'?(ru?'Сохранение операции подтверждено. Можно открыть журнал или начать следующую.':'An operation was confirmed. Open the journal or start the next one.'):(ru?'На устройстве есть подготовленный черновик, который ещё не отправлен.':'A prepared draft is saved on this device and has not been sent.')}/>
   <Text selectable style={styles.muted}>{result.draft.operation.id}</Text><Button label={ru?'Открыть сохранённую операцию':'Open saved operation'} onPress={onOpen}/>
  </>}
  <Button label={ru?'Перепроверить черновик':'Recheck draft'} onPress={()=>setRevision(value=>value+1)}/>
 </Card>;
}
