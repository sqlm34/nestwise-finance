import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import {useApp,type PreviewFile} from '../state';
import {type DraftGroup} from '../domain/reconciliation';
import {parseSave,parseSavedPage,cancellationReasons,type SaveReconciliation,type SavedReconciliation} from '../domain/saved-reconciliation';
import {insightMoney} from '../domain/period-insights';
import {journalDate} from '../domain/journal';
import {Button,Card,Notice,styles} from './ui';

function message(status:number,ru:boolean){
  if(status===409)return ru?'Конфликт: строка или проводка уже сохранена в другой группе, либо суммы/даты не прошли проверку. Обновите историю.':'Conflict: a row or transaction is already reserved, or amount/date validation failed. Refresh history.';
  if(status===404)return ru?'Нет права изменять сверки этого счёта.':'You cannot change reconciliations for this account.';
  return ru?'Ответ не получен. Операция могла сохраниться. Обновите историю или повторите запрос — дубликат не создастся.':'No confirmed response. The operation may have been saved. Refresh history or retry; the same request will not duplicate it.';
}
export function SaveDraftButton({workspace,account,file,group,canWrite,alreadySaved,onSaved,onSessionExpired}:{workspace:string;account:string;file:PreviewFile;group:DraftGroup;canWrite:boolean;alreadySaved:boolean;onSaved:()=>void;onSessionExpired:()=>void}){
  const {locale}=useApp(),ru=locale==='ru';
  const [busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('');
  const request=useRef<SaveReconciliation|null>(null),inFlight=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function save(){
    if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');
    try{
      if(!request.current){
        const rows=await Promise.all(file.preview.rows.filter(row=>group.rows.includes(row.line)).map(async row=>{
          const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,new TextEncoder().encode(row.description.trim().toLowerCase()));
          return {line:row.line,date:row.date,cents:String(row.amountCents),text_hash:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')};
        }));
        request.current=parseSave({id:Crypto.randomUUID(),file_hash:file.hash,rows,transactions:group.transactions});
      }
      if(!mounted.current)return;
      const response=await authenticatedPost(`/v1/user/workspaces/${workspace}/accounts/${account}/reconciliations`,request.current);
      if(!mounted.current)return;
      if(response.status===401){onSessionExpired();return;}
      if(!response.ok){setError(message(response.status,ru));return;}
      const result=await response.json();if(result.id!==request.current.id)throw new Error();
      if(mounted.current){setSaved(true);onSaved();}
    }catch{if(mounted.current)setError(message(503,ru));}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  return <>
    <Button primary label={saved||alreadySaved?(ru?'Сохранено в истории':'Saved to history'):(ru?'Сохранить эту сверку':'Save this reconciliation')} disabled={busy||saved||alreadySaved||!canWrite} onPress={()=>void save()}/>
    {busy&&<ActivityIndicator/>}{!!error&&<Notice error text={error}/>}
  </>;
}

export function SavedReconciliations({workspace,account,revision,onSessionExpired,onOpen,onChanged}:{workspace:string;account:string;revision:number;onSessionExpired:()=>void;onOpen:(id:string)=>void;onChanged:(group:SavedReconciliation)=>void}){
  const {locale,t}=useApp(),ru=locale==='ru';
  const [request,setRequest]=useState<{cursors:(string|null)[];reload:number}>({cursors:[null],reload:0});
  const [result,setResult]=useState<{request:typeof request;revision:number;data:ReturnType<typeof parseSavedPage>|null}|null>(null);
  const [cancel,setCancel]=useState<string|null>(null),[reason,setReason]=useState<typeof cancellationReasons[number]>('recheck');
  const [writing,setWriting]=useState(false),[error,setError]=useState('');
  const mounted=useRef(true),writeLock=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const cursor=request.cursors.at(-1);
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/reconciliations${cursor?'?cursor='+cursor:''}`,controller.signal);
      if(!active)return;if(response.status===401){onSessionExpired();return;}if(!response.ok)throw new Error();
      const data=parseSavedPage(await response.json());if(active)setResult({request,revision,data});
    }catch{if(active)setResult({request,revision,data:null});}})();
    return()=>{active=false;controller.abort();};
  },[workspace,account,request,revision,onSessionExpired]);
  const busy=result?.request!==request||result?.revision!==revision,data=busy?null:result?.data;
  async function cancelGroup(){
    if(!cancel||writeLock.current)return;writeLock.current=true;setWriting(true);setError('');
    try{
      const response=await authenticatedPost(`/v1/user/workspaces/${workspace}/accounts/${account}/reconciliations/${cancel}/cancel`,{reason});
      if(!mounted.current)return;if(response.status===401){onSessionExpired();return;}
      if(!response.ok){setError(message(response.status,ru));return;}
      setCancel(null);setRequest({cursors:[null],reload:request.reload+1});const canceledGroup=data?.groups.find(group=>group.id===cancel);if(canceledGroup)onChanged(canceledGroup);
    }catch{if(mounted.current)setError(message(503,ru));}
    finally{writeLock.current=false;if(mounted.current)setWriting(false);}
  }
  const reasonLabel=(value:string)=>({mistake:ru?'Ошибка выбора':'Selection mistake',duplicate:ru?'Дубликат':'Duplicate',recheck:ru?'Повторная проверка':'Needs another review'}[value]||value);
  return <Card>
    <Text accessibilityRole="header" style={styles.h2}>{ru?'Сохранённые сверки и история':'Saved reconciliations and history'}</Text>
    <Notice text={ru?'Сохранённое решение — проверка пользователя, не утверждённый отчёт бухгалтера. Хранятся даты, суммы, ссылки на проводки и хеши. Оригинал можно отдельно сохранить в приватном архиве выше; связь определяется по SHA-256 файла.':'A saved decision is a user assertion, not an approved accountant report. Dates, amounts, journal references and hashes are retained. Archive the original separately above; its SHA-256 links it to these decisions.'}/>
    <Button label={ru?'Обновить историю':'Refresh history'} disabled={busy||writing} onPress={()=>{setCancel(null);setRequest({cursors:[null],reload:request.reload+1});}}/>
    {!!error&&<Notice error text={error}/>}
    {busy?<ActivityIndicator/>:!data?<Notice error text={t('journalUnavailable')}/>:<>
      {!data.can_write&&<Notice text={ru?'Доступ только для просмотра. Сохранение и отмена доступны владельцу и бухгалтеру.':'Read-only access. Owners and accountants can save and cancel decisions.'}/>}
      {!data.groups.length&&<Text style={styles.muted}>{ru?'Сохранённых решений пока нет.':'No saved decisions yet.'}</Text>}
      {data.groups.map(group=><View key={group.id} style={{gap:8,borderTopWidth:1,borderColor:'#dfe9e3',paddingTop:16}}>
        <Text style={styles.h2}>{group.canceled_at?(ru?'Отменено':'Canceled'):(ru?'Сохранено':'Saved')} · {insightMoney(BigInt(group.amount),locale)}</Text>
        <Text selectable style={styles.muted}>{group.id}</Text>
        <Text style={styles.text}>{journalDate(group.created_at,locale)}</Text>
        <Text selectable style={styles.muted}>{ru?'Автор':'Actor'}: {group.created_by}</Text>
        <Text selectable style={styles.muted}>SHA-256: {group.file_hash}</Text>
        {group.rows.map(row=><Text key={row.line} style={styles.text}>#{row.line} · {row.date} · {insightMoney(BigInt(row.cents),locale)}</Text>)}
        {group.transactions.map(id=><Button key={id} label={`${t('provenanceOpen')} · ${id.slice(0,8)}`} onPress={()=>onOpen(id)}/>)}
        {group.canceled_at?<Text style={styles.muted}>{journalDate(group.canceled_at,locale)} · {reasonLabel(group.reason!)} · {group.canceled_by}</Text>:
          cancel===group.id?<>
            <Text style={styles.text}>{ru?'Причина отмены:':'Cancellation reason:'}</Text>
            <View style={styles.row}>{cancellationReasons.map(value=><Button key={value} label={reasonLabel(value)} selected={reason===value} disabled={writing} onPress={()=>setReason(value)}/>)}</View>
            <Notice text={ru?'Исходное решение останется в истории. Отмена снимает сопоставление, но не удаляет операции из журнала. Если операция создана по выписке, её строка остаётся защищённой от повторного учёта.':'The original decision remains in history. Cancellation removes the match but does not delete journal transactions. A row used to create a bank transaction remains protected against duplicate posting.'}/>
            <Button label={ru?'Подтвердить отмену':'Confirm cancellation'} disabled={writing} onPress={()=>void cancelGroup()}/>
            <Button label={ru?'Оставить решение':'Keep decision'} disabled={writing} onPress={()=>setCancel(null)}/>
          </>:<Button label={ru?'Отменить сохранённую сверку':'Cancel saved reconciliation'} disabled={!data.can_write||writing} onPress={()=>{setCancel(group.id);setReason('recheck');setError('');}}/>}
      </View>)}
      <View style={styles.row}><Button label={t('previous')} disabled={request.cursors.length===1||writing} onPress={()=>{setCancel(null);setRequest({...request,cursors:request.cursors.slice(0,-1)});}}/><Text>{request.cursors.length}</Text><Button label={t('next')} disabled={!data.next_cursor||writing} onPress={()=>{setCancel(null);setRequest({...request,cursors:[...request.cursors,data.next_cursor]});}}/></View>
    </>}
  </Card>;
}
