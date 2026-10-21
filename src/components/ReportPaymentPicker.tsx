import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {authenticatedFetch} from '../auth/client';
import {historyParams,parseHistoryPage,type HistoryPage} from '../domain/journal-history';
import {parseManualDetail} from '../domain/manual-operation';
import {reportMoney} from '../domain/accountant-report';
import {Button,Notice,styles} from './ui';
import {useApp} from '../state';
export type PaymentAccount={workspace:string;account:string;name:string};
export function ReportPaymentPicker({accounts,from,to,disabled,onSelect,onSessionExpired}:{accounts:PaymentAccount[];from:string;to:string;disabled:boolean;onSelect:(id:string,label:string)=>void;onSessionExpired:()=>void}){
 const {locale}=useApp(),ru=locale==='ru';
 const [request,setRequest]=useState<{account:PaymentAccount;cursor:string|null;all:boolean}|null>(null);
 const [result,setResult]=useState<{request:typeof request;page:HistoryPage}|null>(null),[error,setError]=useState(false);
 const [chosen,setChosen]=useState<{request:NonNullable<typeof request>;id:string}|null>(null),[detail,setDetail]=useState<{chosen:typeof chosen;note:string;amount:string;paid:string}|null>(null);
 const page=result?.request===request?result.page:null;
 useEffect(()=>{if(!request)return;let active=true;const abort=new AbortController();
  void(async()=>{try{const a=request.account,r=await authenticatedFetch(`/v1/user/workspaces/${a.workspace}/accounts/${a.account}/journal${historyParams({query:'manual:',from:request.all?'':from,to:request.all?'':to,code:'expenses',order:'newest',basis:'paid'},request.cursor)}`,abort.signal);
   if(!active)return;if(r.status===401){onSessionExpired();return;}if(!r.ok)throw new Error();const p=parseHistoryPage(await r.json());if(active)setResult({request,page:p});
  }catch{if(active)setError(true);}})();return()=>{active=false;abort.abort();};
 },[request,from,to,onSessionExpired]);
 useEffect(()=>{if(!chosen)return;let active=true;const abort=new AbortController();
  void(async()=>{try{const a=chosen.request.account,r=await authenticatedFetch(`/v1/user/workspaces/${a.workspace}/accounts/${a.account}/journal/${chosen.id}`,abort.signal);
   if(!active)return;if(r.status===401){onSessionExpired();return;}if(!r.ok)throw new Error();const d=parseManualDetail(await r.json(),chosen.id);if(d.manual.kind!=='expense')throw new Error();if(active)setDetail({chosen,note:d.manual.note,amount:d.manual.amount_cents,paid:d.manual.paid_on});
  }catch{if(active)setError(true);}})();return()=>{active=false;abort.abort();};
 },[chosen,onSessionExpired]);
 return <View style={{gap:8}}>
 <Text style={styles.muted}>{ru?'Выберите счёт и уже проведённую оплату.':'Choose an account and an existing payment.'}</Text>
 {accounts.length===0&&<Notice text={ru?'Нет доступных счетов для выбора.':'No eligible accounts are available.'}/>}
 <View style={styles.row}>{accounts.map(a=><Button key={a.account} label={a.name} selected={request?.account.account===a.account} disabled={disabled} onPress={()=>{setError(false);setChosen(null);setRequest({account:a,cursor:null,all:false});}}/>)}</View>
 {request&&<Button label={request.all?(ru?'Только период отчёта':'Report period only'):(ru?'Показать все даты':'Show all dates')} disabled={disabled} onPress={()=>{setError(false);setChosen(null);setRequest({...request,cursor:null,all:!request.all});}}/>}
 {request&&!page&&!error&&<ActivityIndicator/>}
 {error&&<Notice error text={ru?'Не удалось прочитать оплату. Выберите счёт заново для повторной проверки доступа.':'Could not read the payment. Select the account again to recheck access.'}/>}
 {page&&page.entries.filter(e=>e.paid_at&&e.entries.some(l=>l.code==='expenses'&&BigInt(l.cents)>0n)).map(e=><Button key={e.id} label={`${new Date(e.paid_at!).toISOString().slice(0,10)} · ${reportMoney(e.entries.find(l=>l.code==='expenses')!.cents)} USD · ${e.id.slice(0,8)}`} selected={chosen?.id===e.id} disabled={disabled} onPress={()=>{setError(false);setChosen({request:request!,id:e.id});}}/>)}
 {page?.entries.length===0&&<Notice text={ru?'За этот период оплат нет. Можно выбрать все даты.':'No payments in this period. You can choose all dates.'}/>}
 {page?.next_cursor&&<Button label={ru?'Более ранние оплаты':'Earlier payments'} disabled={disabled} onPress={()=>{setError(false);setChosen(null);setRequest({...request!,cursor:page.next_cursor});}}/>}
 {chosen&&detail?.chosen===chosen&&<View style={{gap:8}}><Text style={styles.text}>{detail.paid} · {reportMoney(detail.amount)} USD · {detail.note}</Text><Button primary label={ru?'Выбрать эту оплату':'Use this payment'} disabled={disabled} onPress={()=>onSelect(chosen.id,`${detail.paid} · ${reportMoney(detail.amount)} USD · ${detail.note}`)}/></View>}
 </View>;
}
