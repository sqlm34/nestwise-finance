import {localDateTime} from '../domain/local-time';
import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,TextInput,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import {parseStatementPeriod,parsePeriodRecords,statementContinuity,type PeriodRecord} from '../domain/statement-period';
import {cents} from '../domain/money';
import {insightMoney} from '../domain/period-insights';
import {useApp} from '../state';
import {Button,Notice,styles} from './ui';

export function StatementPeriod({workspace,account,hash,canWrite,onSessionExpired}:{workspace:string;account:string;hash:string;canWrite:boolean;onSessionExpired:()=>void}){
  const {locale}=useApp(),ru=locale==='ru';
  const [history,setHistory]=useState<PeriodRecord[]|null>(null),[all,setAll]=useState<PeriodRecord[]>([]);
  const [fields,setFields]=useState({from:'',to:'',opening:'',closing:'',last4:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0),[confirmed,setConfirmed]=useState(false);
  const mounted=useRef(true),lock=useRef(false);
  const [pending,setPending]=useState<{id:string;expected:number;data:ReturnType<typeof parseStatementPeriod>}|null>(null);
  const base=`/v1/user/workspaces/${workspace}/accounts/${account}`,path=`${base}/documents/${hash}/period`;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    let active=true;const controller=new AbortController();
    (async()=>{try{
      const responses=await Promise.all([authenticatedFetch(path,controller.signal),authenticatedFetch(`${base}/statement-periods`,controller.signal)]);
      if(!active)return;if(responses.some(r=>r.status===401)){onSessionExpired();return;}
      if(responses.some(r=>!r.ok))throw new Error();
      const [audit,latest]=await Promise.all(responses.map(async r=>parsePeriodRecords(await r.json())));
      if(active){setHistory(audit.sort((a,b)=>b.revision-a.revision));setAll(latest);}
    }catch{if(active)setError(ru?'Не удалось загрузить периоды. Повторите обновление.':'Could not load periods. Refresh to retry.');}})();
    return()=>{active=false;controller.abort();};
  },[path,base,revision,onSessionExpired,ru]);
  async function save(){
    if(lock.current||!history||!confirmed)return;lock.current=true;setBusy(true);setError('');
    try{
      const command=pending??{id:Crypto.randomUUID(),expected:history[0]?.revision??0,data:parseStatementPeriod({from:fields.from,to:fields.to,last4:fields.last4,opening_cents:String(cents(fields.opening)),closing_cents:String(cents(fields.closing)),confirmed:true})};
      setPending(command);
      const response=await authenticatedPost(path,command);
      if(!mounted.current)return;if(response.status===401){onSessionExpired();return;}
      if(response.status===409){setPending(null);setConfirmed(false);setRevision(n=>n+1);throw new Error(ru?'Версия изменилась. Проверьте историю перед повторным сохранением.':'Version changed. Review history before saving again.');}
      if(response.status===400){setPending(null);setConfirmed(false);throw new Error();}
      if(!response.ok)throw new Error();
      const result=await response.json();if(result.id!==command.id)throw new Error();
      setPending(null);setConfirmed(false);setRevision(n=>n+1);
    }catch(cause){if(mounted.current){
      const conflict=cause instanceof Error&&(cause.message.startsWith('Версия')||cause.message.startsWith('Version'));
      setError(conflict?cause.message:(ru?'Не сохранено или ответ не получен. Проверьте даты, суммы и повторите: повтор безопасен.':'Not saved or response missing. Check dates and amounts, then retry safely.'));
    }}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  const latest=history?.[0],issues=statementContinuity(all);
  const labels={from:ru?'Начало периода (YYYY-MM-DD)':'Period start (YYYY-MM-DD)',to:ru?'Конец периода (YYYY-MM-DD)':'Period end (YYYY-MM-DD)',opening:ru?'Начальный остаток USD':'Opening balance USD',closing:ru?'Конечный остаток USD':'Closing balance USD',last4:ru?'Последние 4 цифры счёта':'Account last 4 digits'};
  const issueLabels={gap:ru?'Пропуск между периодами':'Gap between periods',overlap:ru?'Периоды перекрываются':'Overlapping periods',balance:ru?'Остатки соседних периодов не совпадают':'Adjacent balances do not match',account:ru?'Разные последние цифры счёта':'Different account last digits'};
  return <View style={{gap:10}}>
    <Text accessibilityRole="header" style={styles.h2}>{ru?'Период и остатки выписки':'Statement period and balances'}</Text>
    <Notice text={ru?'Введите данные из банковской выписки и подтвердите их. Проверка сравнит остатки со всеми строками оригинала. Она не создаёт проводки и не подтверждает полноту банковских данных.':'Enter and confirm the values from your bank statement. The check compares balances against all original rows. It creates no journal entries and does not certify bank data completeness.'}/>
    {!history&&!error&&<ActivityIndicator/>}{!!error&&<Notice error text={error}/>}
    <Button label={ru?'Обновить периоды':'Refresh periods'} disabled={busy} onPress={()=>{setError('');setRevision(n=>n+1);}}/>
    {latest&&<Notice error={!latest.check.balanced} text={`${ru?'Последняя версия':'Latest revision'} ${latest.revision}: ${latest.data.from} — ${latest.data.to} · ••••${latest.data.last4}\n${ru?'Разница остатков':'Balance difference'}: ${insightMoney(BigInt(latest.check.difference_cents),locale)} · ${ru?'Строк вне периода':'Rows outside period'}: ${latest.check.outside_rows.length} · ${ru?'Неоднозначных строк':'Ambiguous rows'}: ${latest.check.ambiguous_rows.length}`}/>}
    {issues.map((issue,index)=><Notice key={index} error text={`${issueLabels[issue.kind]}: ${issue.left.slice(0,12)} → ${issue.right.slice(0,12)}`}/>)}
    {canWrite&&history&&<>
      {(Object.keys(labels) as (keyof typeof fields)[]).map(key=><View key={key} style={{gap:4}}><Text style={styles.text}>{labels[key]}</Text><TextInput style={styles.input} accessibilityLabel={labels[key]} value={fields[key]} maxLength={key==='last4'?4:24} editable={!busy&&!pending} onChangeText={value=>{setFields(f=>({...f,[key]:value}));setConfirmed(false);}}/></View>)}
      <Button selected={confirmed} label={ru?'Подтверждаю данные из выписки':'I confirm these statement values'} disabled={busy||!!pending} onPress={()=>setConfirmed(v=>!v)}/>
      <Button primary label={pending?(ru?'Повторить сохранение':'Retry save'):(ru?'Сохранить новую версию':'Save new revision')} disabled={busy||!confirmed||history.length>=100} onPress={()=>void save()}/>
    </>}
    {busy&&<ActivityIndicator/>}
    {history?.map(item=><Text key={item.id} selectable style={styles.muted}>v{item.revision} · {item.data.from} — {item.data.to} · {insightMoney(BigInt(item.data.opening_cents),locale)} → {insightMoney(BigInt(item.data.closing_cents),locale)} · {localDateTime(item.created_at,locale)}</Text>)}
  </View>;
}
