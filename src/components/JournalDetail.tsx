import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {Button,Card,Notice,styles,colors} from './ui';
import {useApp} from '../state';
import {authenticatedFetch} from '../auth/client';
import {journalDate,journalMoney} from '../domain/journal';
import {parseJournalDetail,type JournalDetail as Detail,type SourceEvent} from '../domain/journal-detail';
import type {MessageKey} from '../i18n';
const kinds:Record<SourceEvent['kind'],MessageKey>={
  'job.payment_recorded':'eventPayment','job.part_cost_recorded':'eventPart','job.customer_refund_issued':'eventRefund',
  'job.supplier_credit_received':'eventCredit','job.cost_corrected':'eventCorrection',
  'job.processor_fee_recorded':'provenanceFee','job.processor_fee_refunded':'provenanceFeeRefund',
  'job.financials_finalized':'provenanceFinalized','job.reopened':'provenanceReopened','job.voided':'provenanceVoided',
};
const statuses:Record<SourceEvent['status'],MessageKey>={waiting:'provenanceWaiting',posted:'provenancePosted',asserted:'provenanceAsserted',needs_review:'provenanceReview'};
export function EventSummary({event,onOpen}:{event:SourceEvent;onOpen:(id:string)=>void}){
  const {t,locale}=useApp();
  return <View style={{gap:6,paddingVertical:12,borderTopWidth:1,borderColor:colors.line}}>
    <Text style={styles.h2}>{t(kinds[event.kind])}</Text>
    <Text style={styles.text}>{t('provenanceRevision')}: {event.revision} · {t(statuses[event.status])}</Text>
    <Text selectable style={styles.muted}>{t('journalEvent')}: {event.id}</Text>
    <Text style={styles.muted}>{t('provenanceOccurred')}: {journalDate(event.occurred_at,locale)}</Text>
    <Text style={styles.muted}>{t('journalPaidAt')}: {event.paid_at?journalDate(event.paid_at,locale):t('journalNotPaid')}</Text>
    <Text style={styles.muted}>{t('provenanceReceived')}: {journalDate(event.received_at,locale)}</Text>
    <Text style={styles.muted}>{t('journalPostedAt')}: {event.posted_at?journalDate(event.posted_at,locale):t('provenanceNotPosted')}</Text>
    {event.reference_id&&<Text selectable style={styles.muted}>{t('provenanceReferenceId')}: {event.reference_id}</Text>}
    {event.journal_id&&<Button label={t('provenanceOpen')} onPress={()=>onOpen(event.journal_id!)}/>}
  </View>;
}
export function JournalDetail({workspace,account,transaction,currency,name,onClose,onOpen,onSessionExpired,backLabel='provenanceBack'}:{
  workspace:string;account:string;transaction:string;currency:string;name:string;onClose:()=>void;onOpen:(id:string)=>void;onSessionExpired:()=>void;
  backLabel?:MessageKey;
}){
  const {t,locale}=useApp();
  const [request,setRequest]=useState<{cursors:(number|null)[];revision:number}>({cursors:[null],revision:0});
  const [result,setResult]=useState<{request:typeof request;data:Detail|null;error:MessageKey|null}|null>(null);
  const busy=result?.request!==request,data=busy?null:result?.data;
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const before=request.cursors.at(-1);
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/journal/${transaction}${before?`?before=${before}`:''}`,controller.signal);
      if(!active)return;
      if(response.status===401){onSessionExpired();return;}
      if(!response.ok){setResult({request,data:null,error:response.status===404?'provenanceUnavailable':'journalUnavailable'});return;}
      const detail=parseJournalDetail(await response.json(),transaction);
      if(active)setResult({request,data:detail,error:null});
    }catch{if(active)setResult({request,data:null,error:'journalUnavailable'});}})();
    return ()=>{active=false;controller.abort();};
  },[workspace,account,transaction,request,onSessionExpired]);
  return <Card>
    <View style={styles.between}><Text accessibilityRole="header" style={styles.h2}>{t('provenanceTitle')}</Text>
      <Button label={t(backLabel)} onPress={onClose}/></View>
    <Text style={styles.text}>{name} · {currency}</Text>
    <Notice text={t('provenanceScope')}/>
    <Button label={t('journalRefresh')} disabled={busy} onPress={()=>setRequest(current=>({cursors:[null],revision:current.revision+1}))}/>
    {busy&&<ActivityIndicator color={colors.green} accessibilityLabel={t('authLoading')}/>}
    {!busy&&result?.error&&<Notice error text={t(result.error)}/>}
    {data&&<>
      <Text selectable style={styles.text}>{t('journalOrder')}: {data.transaction.source_order_id}</Text>
      <Text selectable style={styles.muted}>{t('journalEntry')}: {data.transaction.id}</Text>
      {data.transaction.entries.map((line,index)=><Text key={index} style={styles.text}>
        {t(({clearing:'journalClearing',receipts:'journalReceipts',refunds:'journalRefunds',parts_cost:'journalPartsCost',parts_payable:'journalPartsPayable',fees:'journalFees'} as const)[line.code])}
        {' · '}{t(BigInt(line.cents)>0n?'journalDebit':'journalCredit')}{' · '}{journalMoney((BigInt(line.cents)<0n?-BigInt(line.cents):BigInt(line.cents)).toString(),locale,currency)}
      </Text>)}
      <Text accessibilityRole="header" style={styles.h2}>{t('provenanceSource')}</Text>
      <EventSummary event={data.source} onOpen={onOpen}/>
      {data.reference&&<><Text accessibilityRole="header" style={styles.h2}>{t('provenanceReference')}</Text><EventSummary event={data.reference} onOpen={onOpen}/></>}
      <Text accessibilityRole="header" style={styles.h2}>{t('provenanceAudit')}</Text>
      {data.audit.map((entry,index)=><Text key={index} style={styles.muted}>{journalDate(entry.recorded_at,locale)} · {t(entry.action==='applied'?'provenanceApplied':'provenanceReview')}</Text>)}
      {data.audit.length===0&&<Notice text={t('provenanceNoAudit')}/>}
      {data.audit_truncated&&<Notice text={t('provenanceAuditLimit')}/>}
      <Text accessibilityRole="header" style={styles.h2}>{t('provenanceHistory')}</Text>
      <Text style={styles.muted}>{t('page')} {request.cursors.length} · {t('provenanceHistoryHint')}</Text>
      {data.history.map(event=><EventSummary key={event.id} event={event} onOpen={onOpen}/>)}
      <Text style={styles.muted}>{t(data.next_revision?'journalMore':'journalEnd')}</Text>
    </>}
    <View style={styles.row}>
      <Button label={t('previous')} disabled={busy||request.cursors.length===1} onPress={()=>setRequest(current=>({...current,cursors:current.cursors.slice(0,-1)}))}/>
      <Button label={t('next')} disabled={busy||!data?.next_revision} onPress={()=>{if(data?.next_revision)setRequest(current=>({...current,cursors:[...current.cursors,data.next_revision]}));}}/>
    </View>
  </Card>;
}
