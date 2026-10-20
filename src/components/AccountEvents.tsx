import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {Button,Card,Notice,SearchField,styles,colors} from './ui';
import {useApp} from '../state';
import {authenticatedFetch} from '../auth/client';
import {eventStatuses,parseEventsPage,parseEventParams,type EventStatus,type EventsPage,type AccountEvent} from '../domain/account-events';
import {EventSummary,JournalDetail} from './JournalDetail';
import type {MessageKey} from '../i18n';
const statusLabels:Record<EventStatus,MessageKey>={attention:'eventsAttention',all:'eventsAll',waiting:'provenanceWaiting',needs_review:'provenanceReview',posted:'provenancePosted',asserted:'provenanceAsserted'};
const guidanceLabels:Record<AccountEvent['guidance'],MessageKey>={none:'eventsApplied',earlier_revision:'eventsEarlier',excess_refund:'eventsRefund',snapshot_mismatch:'eventsSnapshot',reference:'eventsReference',review:'eventsReview'};
type RequestState={status:EventStatus;query:string;cursors:(string|null)[];revision:number};
export function AccountEvents({workspace,account,name,currency,onSessionExpired}:{workspace:string;account:string;name:string;currency:string;onSessionExpired:()=>void}){
  const {t}=useApp();
  const [status,setStatus]=useState<EventStatus>('attention'),[query,setQuery]=useState('');
  const [selected,setSelected]=useState<{kind:'event'|'journal';id:string}|null>(null);
  const openJournal=(id:string)=>setSelected({kind:'journal',id});
  const [request,setRequest]=useState<RequestState>({status:'attention',query:'',cursors:[null],revision:0});
  const [result,setResult]=useState<{request:RequestState;data:EventsPage|null;error:MessageKey|null}|null>(null);
  const busy=result?.request!==request,data=busy?null:result?.data;
  const dirty=status!==request.status||query!==request.query;
  let invalid=false;try{parseEventParams(new URLSearchParams({status,q:query}));}catch{invalid=true;}
  const restart=(nextStatus:EventStatus,nextQuery:string)=>setRequest(current=>({status:nextStatus,query:nextQuery,cursors:[null],revision:current.revision+1}));
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const params=new URLSearchParams({status:request.status,q:request.query});
      const cursor=request.cursors.at(-1);if(cursor)params.set('cursor',cursor);
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/events?${params}`,controller.signal);
      if(!active)return;
      if(response.status===401){onSessionExpired();return;}
      if(!response.ok){setResult({request,data:null,error:response.status===404?'journalAccessLost':response.status===400?'eventsRestart':'journalUnavailable'});return;}
      const page=parseEventsPage(await response.json());if(active)setResult({request,data:page,error:null});
    }catch{if(active)setResult({request,data:null,error:'journalUnavailable'});}})();
    return()=>{active=false;controller.abort();};
  },[workspace,account,request,onSessionExpired]);
  if(selected)return <JournalDetail key={`${selected.kind}:${selected.id}`} workspace={workspace} account={account} name={name} currency={currency}
    transaction={selected.kind==='journal'?selected.id:undefined} event={selected.kind==='event'?selected.id:undefined}
    onOpen={openJournal} onSessionExpired={onSessionExpired} backLabel="eventsBack"
    onClose={()=>{setSelected(null);setRequest(current=>({...current,revision:current.revision+1}));}}/>;
  return <Card>
    <Text accessibilityRole="header" style={styles.h2}>{t('eventsTitle')}</Text>
    <Text style={styles.text}>{name} · {currency}</Text>
    <Notice text={t('eventsScope')}/>
    <SearchField value={query} onChange={setQuery} placeholder={t('eventsSearch')}/>
    <View style={styles.row}>{eventStatuses.map(value=><Button key={value} label={t(statusLabels[value])} selected={status===value} onPress={()=>setStatus(value)}/>)}</View>
    <View style={styles.row}>
      <Button label={t('journalApply')} primary disabled={busy||invalid} onPress={()=>restart(status,query)}/>
      <Button label={t('journalReset')} disabled={busy} onPress={()=>{setStatus('attention');setQuery('');restart('attention','');}}/>
      <Button label={t('eventsRefresh')} disabled={busy} onPress={()=>restart(request.status,request.query)}/>
    </View>
    {invalid&&<Notice error text={t('journalInvalidQuery')}/>}
    {dirty&&<Notice text={t('journalUnapplied')}/>}
    {busy&&<ActivityIndicator color={colors.green} accessibilityLabel={t('authLoading')}/>}
    {!busy&&result?.error&&<Notice error text={t(result.error)}/>}
    {data&&<>
      <Text style={styles.muted}>{t('eventsCountScope')}</Text>
      {(['waiting','needs_review','posted','asserted'] as const).map(value=><Button key={value} label={`${t(statusLabels[value])}: ${data.counts[value]}`}
        onPress={()=>{setStatus(value);setQuery(request.query);restart(value,request.query);}}/>)}
      <Text style={styles.muted}>{t('page')} {request.cursors.length} · {t('journalShown')} {data.events.length} · {t('eventsOrder')}</Text>
      {data.events.length===0&&<Notice text={t('eventsEmpty')}/>}
      {data.events.map(event=><View key={event.cursor} style={{gap:8,paddingTop:16}}>
        <Text selectable style={styles.h2}>{t('journalOrder')}: {event.order_id}</Text>
        <Notice text={t(guidanceLabels[event.guidance])}/>
        <View style={styles.row}>
          <Button label={t('eventsDetailOpen')} onPress={()=>setSelected({kind:'event',id:event.cursor})}/>
          <Button label={t('eventsOrderSearch')} onPress={()=>{setStatus('all');setQuery(event.order_id);restart('all',event.order_id);}}/>
        </View>
        <EventSummary event={event} onOpen={openJournal}/>
      </View>)}
      <Text style={styles.muted}>{t(data.next_cursor?'eventsMore':'journalEnd')}</Text>
    </>}
    <View style={styles.row}>
      <Button label={t('previous')} disabled={busy||request.cursors.length===1} onPress={()=>setRequest(current=>({...current,cursors:current.cursors.slice(0,-1)}))}/>
      <Button label={t('next')} disabled={busy||!data?.next_cursor} onPress={()=>{if(data?.next_cursor)setRequest(current=>({...current,cursors:[...current.cursors,data.next_cursor]}));}}/>
    </View>
    <Text style={styles.muted}>{t('eventsLive')}</Text>
  </Card>;
}
