import React,{useEffect,useState} from 'react';
import {AppState,Pressable,Text,View} from 'react-native';
import {authenticatedFetch} from '../auth/client';
import {useApp} from '../state';
export function CrmConnectionStatus({workspace,account}:{workspace:string;account:string}){
 const {locale}=useApp(),ru=locale==='ru';
 const [revision,setRevision]=useState(0);
 const [result,setResult]=useState<{revision:number;status:{connected:boolean;reason:string;last:string|null}}|null>(null);
 const status=result?.revision===revision?result.status:null;
 useEffect(()=>{
  const controller=new AbortController();let active=true;
  void (async()=>{try{
   const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/crm-status`,controller.signal);
   if(!response.ok)throw new Error();const data=await response.json();
   if(typeof data.connected!=='boolean'||!['ready','disabled','not_connected','key_unavailable'].includes(data.reason)||data.connected!==(data.reason==='ready')||data.last_received_at!==null&&(typeof data.last_received_at!=='string'||!Number.isFinite(Date.parse(data.last_received_at))))throw new Error();
   if(active)setResult({revision,status:{connected:data.connected,reason:data.reason,last:data.last_received_at}});
  }catch{if(active)setResult({revision,status:{connected:false,reason:'unavailable',last:null}});}})();
  return()=>{active=false;controller.abort();};
 },[workspace,account,revision]);
 useEffect(()=>{const timer=setInterval(()=>setRevision(value=>value+1),60000);const listener=AppState.addEventListener('change',state=>{if(state==='active')setRevision(value=>value+1);});return()=>{clearInterval(timer);listener.remove();};},[]);
 const green=status?.connected===true,color=!status?'#70857c':green?'#16714e':'#a34242';
 const title=!status?(ru?'Проверяем связь с CRM…':'Checking CRM connection…'):green?(ru?'CRM подключена':'CRM connected'):status.reason==='unavailable'?(ru?'Связь с CRM не подтверждена':'CRM connection could not be verified'):(ru?'CRM не подключена':'CRM disconnected');
 return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${ru?'Проверить снова':'Check again'}`} onPress={()=>setRevision(value=>value+1)} style={{padding:12,borderRadius:11,borderWidth:1,borderColor:!status?'#dfe9e3':green?'#c5dfd0':'#f1caca',backgroundColor:!status?'#f4f7f5':green?'#e4f5ec':'#fceeee',gap:5}}>
  <View style={{flexDirection:'row',alignItems:'center',gap:8}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:color}}/><Text accessibilityLiveRegion="polite" style={{fontSize:12,fontWeight:'700',color}}>{title}</Text></View>
  {status?.last&&<Text style={{fontSize:11,color}}>{ru?'Последнее событие: ':'Last event: '}{new Date(status.last).toLocaleString(ru?'ru-RU':'en-US')}</Text>}
  {status?.reason==='key_unavailable'&&<Text style={{fontSize:11,color}}>{ru?'Ключ подключения недоступен или срок действия истёк.':'Connection key is unavailable or expired.'}</Text>}
  {green&&<Text style={{fontSize:11,color}}>{ru?'Приём событий включён. Нажмите для повторной проверки.':'Event reception enabled. Tap to check again.'}</Text>}
 </Pressable>;
}
