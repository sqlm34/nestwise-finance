import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,TextInput,View} from 'react-native';
import {authenticatedFetch} from '../auth/client';
import {reportMoney} from '../domain/accountant-report';
import {cents} from '../domain/money';
import {Button,Notice,styles} from './ui';
import {useApp} from '../state';
export type PaymentAccount={workspace:string;account:string;name:string};
type Candidate={id:string;paid_on:string;amount_cents:string;note:string;file_hash:string|null;bank_date:string|null;refund_cents:string};
export function ReportPaymentPicker({accounts,from,to,disabled,onSelect,onSessionExpired}:{accounts:PaymentAccount[];from:string;to:string;disabled:boolean;onSelect:(id:string,label:string)=>void;onSessionExpired:()=>void}){
 const {locale}=useApp(),ru=locale==='ru';
 const [account,setAccount]=useState<PaymentAccount|null>(null),[query,setQuery]=useState(''),[minimum,setMinimum]=useState(''),[start,setStart]=useState(from),[end,setEnd]=useState(to);
 const [request,setRequest]=useState<{account:PaymentAccount;query:string;from:string;to:string;min:string;revision:number}|null>(null);
 const [result,setResult]=useState<{request:typeof request;rows:Candidate[]}|null>(null),[error,setError]=useState('');
 const [chosen,setChosen]=useState<Candidate|null>(null);
 const rows=result?.request===request?result.rows:null;
 useEffect(()=>{if(!request)return;let active=true;const abort=new AbortController();
  void(async()=>{try{const a=request.account,q=new URLSearchParams({query:request.query,min:request.min});if(request.from)q.set('from',request.from);if(request.to)q.set('to',request.to);
   const r=await authenticatedFetch(`/v1/user/workspaces/${a.workspace}/accounts/${a.account}/purchase-candidates?${q}`,abort.signal);
   if(!active)return;if(r.status===401){onSessionExpired();return;}if(r.status===409){setError(ru?'Слишком много покупок. Уточните даты, описание или минимальную сумму.':'Too many purchases. Narrow the dates, description or minimum amount.');return;}if(!r.ok)throw new Error();
   const data=await r.json();if(!Array.isArray(data)||data.length>100||data.some(x=>!x||typeof x.id!=='string'||!/^[0-9a-f-]{36}$/i.test(x.id)||typeof x.note!=='string'||typeof x.amount_cents!=='string'||!/^\d+$/.test(x.amount_cents)||typeof x.paid_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x.paid_on)||typeof x.refund_cents!=='string'||!/^\d+$/.test(x.refund_cents)))throw new Error();
   if(active)setResult({request,rows:data});
  }catch{if(active)setError(ru?'Не удалось прочитать покупки. Проверьте даты и обновите поиск.':'Could not read purchases. Check dates and search again.');}})();return()=>{active=false;abort.abort();};
 },[request,onSessionExpired,ru]);
 function search(a=account){if(!a)return;try{const min=minimum.trim()?cents(minimum).toString():'0';if(BigInt(min)<0n)throw new Error();setChosen(null);setError('');setRequest(r=>({account:a,query,from:start.trim(),to:end.trim(),min,revision:(r?.revision??0)+1}));}catch{setError(ru?'Проверьте сумму.':'Check the amount.');}}
 const input=(label:string,value:string,change:(s:string)=>void)=><TextInput accessibilityLabel={label} placeholder={label} value={value} editable={!disabled} onChangeText={change} style={styles.input}/>;
 return <View style={{gap:8}}><Text style={styles.muted}>{ru?'Поиск уже проведённых покупок. Совпадение суммы — только подсказка; проверьте продавца и дату.':'Search existing purchases. An amount match is only a hint; check merchant and date.'}</Text>
 {accounts.length===0&&<Notice text={ru?'Нет доступных счетов.':'No eligible accounts.'}/>}
 <View style={styles.row}>{accounts.map(a=><Button key={a.account} label={a.name} selected={account?.account===a.account} disabled={disabled} onPress={()=>{setAccount(a);setChosen(null);setResult(null);setRequest(null);setError('');}}/>)}</View>
 {account&&<>{input(ru?'Продавец / описание':'Merchant / description',query,setQuery)}{input(ru?'Минимальная сумма покупки, USD':'Minimum purchase amount, USD',minimum,setMinimum)}{input(ru?'От YYYY-MM-DD, пусто — все даты':'From YYYY-MM-DD, blank for all',start,setStart)}{input(ru?'До YYYY-MM-DD, пусто — все даты':'To YYYY-MM-DD, blank for all',end,setEnd)}
 <View style={styles.row}><Button label={ru?'Все даты':'All dates'} disabled={disabled} onPress={()=>{setStart('');setEnd('');}}/><Button primary label={ru?'Найти покупки':'Find purchases'} disabled={disabled} onPress={()=>search()}/></View></>}
 {request&&!rows&&!error&&<ActivityIndicator/>}{error&&<Notice error text={error}/>}
 {rows?.map(p=><Button key={p.id} label={`${p.paid_on} · ${reportMoney(p.amount_cents)} USD · ${p.note}`} selected={chosen?.id===p.id} disabled={disabled} onPress={()=>setChosen(p)}/>)}
 {rows?.length===0&&<Notice text={ru?'Покупок не найдено. Расширьте даты либо загрузите выписку в разделе «Банк» и проверьте исходную оплату.':'No purchases found. Broaden the dates or upload a statement under Bank and check the original payment.'}/>}
 {chosen&&<View style={{gap:8}}><Text style={styles.text}>{chosen.paid_on} · {reportMoney(chosen.amount_cents)} USD · {chosen.note}</Text>{chosen.file_hash&&<Text selectable style={styles.muted}>{ru?'Из банковской выписки':'From bank statement'}: {chosen.file_hash} · {chosen.bank_date}</Text>}{chosen.refund_cents!=='0'&&<Notice text={`${ru?'Есть возвраты':'Has refunds'}: ${reportMoney(chosen.refund_cents)} USD`}/>}
 <Button primary label={ru?'Выбрать эту оплату':'Use this payment'} disabled={disabled} onPress={()=>onSelect(chosen.id,`${chosen.paid_on} · ${reportMoney(chosen.amount_cents)} USD · ${chosen.note}`)}/></View>}
 </View>;
}
