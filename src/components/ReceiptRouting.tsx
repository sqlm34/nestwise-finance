import React,{useEffect,useState} from 'react';
import {View} from 'react-native';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import type {Selection} from '../domain/live-navigation';
import {Button,Notice} from './ui';
export function ReceiptRouting({path,review,account,ru,onRouted,onBlocked,onEdit,onSessionExpired}:{path:string;review:string;account:string;ru:boolean;onRouted:(target:Selection)=>void;onBlocked:(blocked:boolean)=>void;onEdit:()=>void;onSessionExpired:()=>void}){
 const [target,setTarget]=useState<Selection|null>(null),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{let active=true;onBlocked(true);void authenticatedFetch(path+'/route').then(async r=>{
  if(r.status===401){onSessionExpired();return;}if(!r.ok)throw Error();const result=await r.json();
  if(active){setTarget(result.target);setLoaded(true);onBlocked(!!result.target&&result.target.account!==account);setError('');}
 }).catch(()=>{if(active)setError(ru?'Не удалось проверить счёт карты. Повторите проверку перед записью расхода.':'Could not check the card account. Retry before recording an expense.');});return()=>{active=false;};},[path,review,account,onBlocked,onSessionExpired,ru,revision]);
 async function route(){setBusy(true);setError('');try{
  const r=await authenticatedPost(path+'/route',{review});if(r.status===401){onSessionExpired();return;}if(!r.ok)throw Error();const result=await r.json();if(!result.target)throw Error();onRouted(result.target);
 }catch{setError(ru?'Перенос не подтверждён. Уже учтённый расход переносить нельзя. Оригинал сохранён; повтор не создаёт расход.':'Transfer was not confirmed. A recorded expense cannot be transferred. The original is retained; retrying does not create an expense.');}finally{setBusy(false);}}
 return <View style={{gap:8}}>
  {!!error&&<><Notice error text={error}/><Button label={ru?'Повторить проверку карты':'Retry card check'} disabled={busy} onPress={()=>setRevision(v=>v+1)}/></>}
  {loaded&&(target?<Notice text={`${ru?'Счёт по карте':'Account identified by card'}: ${target.name}`}/>:<Notice text={ru?'Карта не определена однозначно. Проверьте выбранный счёт вручную. Личные покупки для бизнеса отмечаются по отдельным позициям.':'Card is not uniquely identified. Check the selected account manually. Mark personal-card business purchases by item.'}/>)}
  {loaded&&target&&target.account!==account&&<><Notice text={ru?'Чек относится к другому счёту. Перенесите его перед учётом оплаты.':'This receipt belongs to another account. Transfer it before recording payment.'}/><Button primary label={`${ru?'Открыть чек в':'Open receipt in'} ${target.name}`} disabled={busy} onPress={()=>void route()}/><Button label={ru?'Исправить распознанную карту':'Correct recognized card'} disabled={busy} onPress={onEdit}/></>}
 </View>;
}
