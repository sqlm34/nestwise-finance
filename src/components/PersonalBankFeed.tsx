import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {authenticatedFetch} from '../auth/client';
import {onForegroundRefresh} from '../foreground-refresh';
import {useApp} from '../state';
import {localDateTime} from '../domain/local-time';
import {periodPreset} from '../domain/period-insights';
import {exactUsd} from '../domain/exact-money';
import {Button,Card,Notice,colors,styles} from './ui';
import {AutomaticUpdates} from './AutomaticUpdates';
type Feed={connection:null|{institution:string;name:string;mask:string;enabled:boolean;checked_at:string|null;changed_at:string|null;error:string|null};
 rows:{id:string;paid_on:string;name:string;cents:string;pending:boolean;category:string;currency:string}[];count?:number};
export function PersonalBankFeed({workspace,account,onSessionExpired,allowAppUpdate=false}:{workspace:string;account:string;onSessionExpired:()=>void;allowAppUpdate?:boolean}){
 const {locale}=useApp(),ru=locale==='ru';const [period,setPeriod]=useState(()=>periodPreset('month'));
 const [feed,setFeed]=useState<Feed|null>(null),[error,setError]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let active=true,inFlight=false;
  const refresh=async()=>{
   if(inFlight)return;inFlight=true;
   try{
    const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/bank-feed?from=${period.from}&to=${period.to}`,controller.signal);
    if(!active)return;if(response.status===401){onSessionExpired();return;}if(!response.ok)throw Error();
    const value=await response.json() as Feed;
    if(!Array.isArray(value.rows)||value.rows.some(r=>typeof r.cents!=='string'||! /^-?\d+$/.test(r.cents)||typeof r.name!=='string'||r.currency!=='USD'))throw Error();
    if(active){setFeed(value);setError(false);}
   }catch{if(active)setError(true);}finally{inFlight=false;}
  };
  void refresh();const stop=onForegroundRefresh(()=>void refresh(),60_000);
  return()=>{active=false;controller.abort();stop();};
 },[workspace,account,period.from,period.to,revision,onSessionExpired]);
 const shift=(amount:number)=>{setFeed(null);const date=new Date(period.from+'T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+amount);setPeriod(periodPreset('month',date));};
 const connection=feed?.connection;
 return <Card>
  <AutomaticUpdates canApply={allowAppUpdate}/>
  <Text style={styles.h2}>{ru?'Личные банковские операции':'Personal bank transactions'}</Text>
  <View style={styles.between}><Button label={ru?'← Месяц':'← Month'} onPress={()=>shift(-1)}/><Text style={styles.text}>{period.from.slice(0,7)}</Text><Button label={ru?'Месяц →':'Month →'} onPress={()=>shift(1)}/></View>
  {error&&<Notice error text={ru?'Не удалось обновить операции. Сохранённые данные остаются на экране.':'Could not refresh transactions. Previously loaded data remains visible.'}/>}
  {!feed&&!error&&<ActivityIndicator color={colors.green}/>}
  {feed&&!connection&&<Notice text={ru?'Для этого личного счёта банк ещё не подключён.':'No bank is connected to this personal account yet.'}/>}
  {connection&&<View style={{backgroundColor:colors.pale,padding:14,borderRadius:10,gap:4}}>
   <Text style={styles.h2}>{connection.institution} · •{connection.mask}</Text><Text style={styles.muted}>{connection.name}</Text>
   {connection.changed_at&&<Text style={styles.muted}>{ru?'Последние новые данные: ':'Last data change: '}{localDateTime(connection.changed_at,locale)}</Text>}
   {connection.checked_at&&<Text style={styles.muted}>{ru?'Проверено: ':'Checked: '}{localDateTime(connection.checked_at,locale)}</Text>}
   {!!connection.error&&<Notice error text={connection.error==='login_required'?(ru?'Банк просит повторно войти для обновления данных.':'The bank requires you to reconnect.'):(ru?'Банк временно не обновляется. Повторим автоматически.':'Bank sync is temporarily unavailable. We will retry automatically.')}/>}
   <Text style={styles.muted}>{ru?'Новые данные Plaid проверяются автоматически каждые 15 минут. Сам банк может передавать операции с задержкой.':'New Plaid data is checked automatically every 15 minutes. The bank may provide transactions with a delay.'}</Text>
  </View>}
  <Button label={ru?'Обновить экран':'Refresh view'} onPress={()=>setRevision(v=>v+1)}/>
  {feed&&connection&&feed.rows.length===0&&<Text style={styles.muted}>{ru?'За этот месяц операции ещё не получены.':'No transactions received for this month yet.'}</Text>}
  {feed?.rows.map(row=>{const cents=BigInt(row.cents);return <View key={row.id} style={{paddingVertical:12,borderBottomWidth:1,borderColor:colors.line,gap:4}}>
   <View style={styles.between}><Text style={[styles.text,{flex:1}]}>{row.name}</Text><Text style={{color:cents>0n?colors.green:colors.ink,fontWeight:'700'}}>{cents>0n?'+':''}{exactUsd(cents,locale)}</Text></View>
   <Text style={styles.muted}>{row.paid_on} · {row.pending?(ru?'Ожидает подтверждения':'Pending'):(cents>0n?(ru?'Поступление':'Money in'):(ru?'Списание':'Money out'))}</Text>
  </View>;})}
  {!!feed?.count&&feed.count>feed.rows.length&&<Notice text={ru?'Показаны последние 500 операций за месяц.':'Showing the latest 500 transactions for this month.'}/>}
 </Card>;
}
