import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';
import {useApp} from '../state';
import {useBackStep} from '../back-navigation';
import {authenticatedFetch} from '../auth/client';
import {onForegroundRefresh} from '../foreground-refresh';
import {localToday} from '../domain/local-time';
import {exactUsd} from '../domain/exact-money';
import {loadExpenseMonth,serviceExpenses,pieSlices,shiftExpenseMonth} from '../domain/service-expenses';
import {Button,Card,Notice,styles,colors} from './ui';
export function PersonalExpenseChart({workspace,account,onClose,onSessionExpired}:{workspace:string;account:string;onClose:()=>void;onSessionExpired:()=>void}){
 const {locale}=useApp(),ru=locale==='ru';const [month,setMonth]=useState(()=>localToday().slice(0,7)),[selected,setSelected]=useState('');
 const [result,setResult]=useState<{month:string;data:ReturnType<typeof serviceExpenses>;connected:boolean}|null>(null),[error,setError]=useState(false);
 useBackStep(true,onClose,20);
 const changeMonth=(next:string)=>{setMonth(next);setError(false);setSelected('');};
 useEffect(()=>{let active=true,loading=false;const controller=new AbortController();
  const load=async()=>{if(loading)return;loading=true;try{
   const feed=await loadExpenseMonth(month,async p=>{const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/bank-feed?from=${p.from}&to=${p.to}`,controller.signal);
    if(response.status===401){if(active)onSessionExpired();throw Error();}if(!response.ok)throw Error();return response.json();});
   const data=serviceExpenses(feed.rows,month);if(active){setResult({month,data,connected:!!feed.connection});setError(false);}
  }catch{if(active)setError(true);}finally{loading=false;}};
  void load();const stop=onForegroundRefresh(()=>void load(),60_000);return()=>{active=false;controller.abort();stop();};
 },[workspace,account,month,onSessionExpired]);
 const data=result?.month===month?result.data:null,paths=data?pieSlices(data.groups.map(g=>g.spent)):[];
 const money=(v:bigint)=>exactUsd(v,locale),monthName=(m:string)=>new Date(m+'-15T12:00:00Z').toLocaleDateString(ru?'ru-RU':'en-US',{month:'long',year:'numeric',timeZone:'UTC'});
 return <Card><View style={styles.between}><Text style={styles.h2}>{ru?'Диаграмма расходов':'Expense chart'}</Text><Button label={ru?'Назад':'Back'} onPress={onClose}/></View>
  <Text style={styles.muted}>{ru?'Только OpenAI, Cloudflare и Retell AI. Данные выбранного банковского счёта; другие расходы сюда не входят.':'OpenAI, Cloudflare and Retell AI only. Selected bank account; other expenses are not included.'}</Text>
  <View style={styles.row}>{['2026-09','2026-10','2026-11'].map(m=><Button key={m} label={monthName(m)} selected={month===m} onPress={()=>changeMonth(m)}/>)}</View>
  <View style={styles.between}><Button label="←" onPress={()=>changeMonth(shiftExpenseMonth(month,-1))}/><Text style={styles.h2}>{monthName(month)}</Text><Button label="→" onPress={()=>changeMonth(shiftExpenseMonth(month,1))}/></View>
  {error&&<Notice error text={ru?'Не удалось получить полные данные. Сохранённые суммы могут быть устаревшими; повторим автоматически.':'Could not load complete data. Displayed totals may be stale; retrying automatically.'}/>}
  {!data&&!error&&<ActivityIndicator color={colors.green}/>}
  {data&&<>
   {!result?.connected?<Notice text={ru?'Этот счёт не подключён к банку. Выберите подключённый счёт в верхнем меню.':'This account is not connected. Select the connected Chase or Old National account.'}/>:data.posted===0?<Notice text={ru?'За этот месяц банк пока не передал подтверждённые операции. Это не означает отсутствие расходов.':'No posted transactions received for this month yet. This does not mean there were no expenses.'}/>:data.total===0n?<Notice text={ru?'В загруженных операциях за месяц списаний этим сервисам не найдено.':'No charges for these services found in the loaded transactions for this month.'}/>:<View style={{alignItems:'center'}}><Svg width={240} height={240} viewBox="0 0 240 240" accessible accessibilityLabel={ru?'Доли расходов по сервисам. Суммы перечислены ниже.':'Service expense shares. Amounts are listed below.'}>{data.groups.map((g,i)=>paths[i]?<Path key={g.id} d={paths[i]} fill={g.color}/>:null)}</Svg><Text style={styles.h2}>{ru?'Списано за месяц':'Charged this month'}: {money(data.total)}</Text></View>}
   {data.groups.map(g=><View key={g.id} style={{gap:6,paddingVertical:8}}><View style={{flexDirection:'row',alignItems:'center',gap:10}}><View style={{width:14,height:14,borderRadius:7,backgroundColor:g.color}}/><View style={{flex:1}}><Button label={`${g.name} · ${money(g.spent)}`} selected={selected===g.id} onPress={()=>setSelected(selected===g.id?'':g.id)}/></View></View>
    {g.refunds>0n&&<Text style={styles.muted}>{ru?'Возвраты':'Refunds'}: {money(g.refunds)} · {ru?'После возвратов':'After refunds'}: {money(g.spent-g.refunds)}</Text>}
    {selected===g.id&&(g.rows.length?g.rows.map(r=><View key={r.id} style={{gap:3,padding:8}}><Text style={styles.text}>{r.paid_on} · {r.name}</Text><Text style={styles.text}>{money(BigInt(r.cents))}</Text></View>):<Text style={styles.muted}>{ru?'Операций не найдено.':'No transactions found.'}</Text>)}
   </View>)}
   <Text style={styles.muted}>{ru?'Диаграмма показывает списания. Возвраты указаны отдельно. Ожидающие операции не включены. Сервисы определяются по названию банковской операции. Выписки PDF и чеки повторно не прибавляются.':'Chart shows charges; refunds appear separately. Pending transactions are excluded. Services are matched by bank transaction name. PDFs and receipts are not added again.'}</Text>
   {!!data.pending&&<Text style={styles.muted}>{ru?'Ожидают подтверждения':'Pending'}: {data.pending}</Text>}
  </>}
 </Card>;
}


