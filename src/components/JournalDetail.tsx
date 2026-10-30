import React,{useEffect,useState} from 'react';
import {useBackStep} from '../back-navigation';
import {transactionLabel,transactionPerson,transactionAmount} from '../domain/transaction-label';
import {ActivityIndicator,Text,View} from 'react-native';
import {Button,Card,Notice,styles,colors} from './ui';
import {useApp} from '../state';
import {authenticatedFetch} from '../auth/client';
import {journalDate,journalMoney} from '../domain/journal';
import {parseJournalDetail,parseEventDetail,type EventDetail,type JournalDetail as Detail,type SourceEvent} from '../domain/journal-detail';
import type {MessageKey} from '../i18n';
import {parseManualDetail,type ManualDetail} from '../domain/manual-operation';
import {saveReceiptOriginal} from '../receipt-file';
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
export function JournalDetail({workspace,account,transaction,event,currency,name,onClose,onOpen,onSessionExpired,backLabel='provenanceBack'}:{
  workspace:string;account:string;transaction?:string;event?:string;currency:string;name:string;onClose:()=>void;onOpen:(id:string)=>void;onSessionExpired:()=>void;
  backLabel?:MessageKey;
}){
  const {t,locale}=useApp();
  const [request,setRequest]=useState<{cursors:(number|null)[];revision:number}>({cursors:[null],revision:0});
  const [result,setResult]=useState<{request:typeof request;data:Detail|EventDetail|null;manual?:ManualDetail;error:MessageKey|null}|null>(null);
  const [saving,setSaving]=useState(false),[saveError,setSaveError]=useState(false);
  const [technical,setTechnical]=useState(!!event);
  useBackStep(true,onClose,30);
  const busy=result?.request!==request,data=busy?null:result?.data;
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const before=request.cursors.at(-1);
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/${event?'events/'+event:'journal/'+transaction}${before?`?before=${before}`:''}`,controller.signal);
      if(!active)return;
      if(response.status===401){onSessionExpired();return;}
      if(!response.ok){setResult({request,data:null,error:response.status===404?(event?'eventsDetailUnavailable':'provenanceUnavailable'):'journalUnavailable'});return;}
      const payload=await response.json();
      if(!event&&payload.manual){if(active)setResult({request,data:null,manual:parseManualDetail(payload,transaction!),error:null});return;}
      const detail=event?parseEventDetail(payload,event):parseJournalDetail(payload,transaction!);
      if(active)setResult({request,data:detail,error:null});
    }catch{if(active)setResult({request,data:null,error:'journalUnavailable'});}})();
    return ()=>{active=false;controller.abort();};
  },[workspace,account,transaction,event,request,onSessionExpired]);
  return <Card>
    <View style={styles.between}><Text accessibilityRole="header" style={styles.h2}>{event?t('eventsDetailTitle'):(locale==='ru'?'Об операции':'About this transaction')}</Text>
      <Button label={t(backLabel)} onPress={onClose}/></View>
    <Text style={styles.text}>{name} · {currency}</Text>
    {technical&&<Notice text={t('provenanceScope')}/>}
    <Button label={t(event?'eventsRefresh':'journalRefresh')} disabled={busy} onPress={()=>setRequest(current=>({cursors:[null],revision:current.revision+1}))}/>
    {busy&&<ActivityIndicator color={colors.green} accessibilityLabel={t('authLoading')}/>}
    {!busy&&result?.error&&<Notice error text={t(result.error)}/>}
    {!busy&&result?.manual&&<>
      <Text style={styles.h2}>{transactionLabel(result.manual.transaction,locale)}</Text>
      <Text style={styles.text}>{journalMoney(result.manual.manual.amount_cents,locale,currency)} · {result.manual.manual.paid_on}</Text>
      <Text style={styles.text}>{result.manual.manual.note}</Text>
      <Text style={styles.muted}>{locale==='ru'?'Возвращено':'Refunded'}: {journalMoney(result.manual.refunded_cents,locale,currency)}</Text>
      <Text selectable style={styles.muted}>{locale==='ru'?'Автор':'Recorded by'}: {result.manual.actor}</Text>
      <Text style={styles.muted}>{journalDate(result.manual.created_at,locale)}</Text>
      {result.manual.receipt&&<>
        <Text style={styles.h2}>{locale==='ru'?'Подтверждающий чек':'Receipt evidence'}</Text>
        <Text style={styles.text}>{result.manual.receipt.data.supplier} · {result.manual.receipt.data.date} · {locale==='ru'?'Версия':'Version'} {result.manual.receipt.revision}</Text>
        <Text selectable style={styles.muted}>{result.manual.receipt.hash}</Text>
        <Button label={locale==='ru'?'Сохранить оригинал чека':'Save original receipt'} disabled={saving} onPress={()=>{const hash=result.manual!.receipt!.hash;setSaving(true);setSaveError(false);void (async()=>{try{
          const r=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/receipts/${hash}/original`);
          if(r.status===401){onSessionExpired();return;}if(!r.ok)throw new Error();await saveReceiptOriginal(new Uint8Array(await r.arrayBuffer()),hash);
        }catch{setSaveError(true);}finally{setSaving(false);}})();}}/>
        {saveError&&<Notice error text={locale==='ru'?'Не удалось сохранить оригинал. Повторите запрос.':'Could not save the original. Retry the request.'}/>}
      </>}
      <Button label={technical?(locale==='ru'?'Скрыть технические подробности':'Hide technical details'):(locale==='ru'?'Технические подробности':'Technical details')} onPress={()=>setTechnical(value=>!value)}/>
      {technical&&<>
      <Text selectable style={styles.text}>{result.manual.manual.id}</Text>
      {result.manual.manual.reference_operation&&<Text selectable style={styles.text}>{locale==='ru'?'Исходная операция':'Original operation'}: {result.manual.manual.reference_operation}</Text>}
      {result.manual.manual.allocations.map(a=><Text key={a.category} style={styles.text}>{a.category} · {journalMoney(a.cents,locale,currency)}</Text>)}
      {result.manual.transaction.entries.map((line,index)=><Text key={index} style={styles.text}>{line.code} · {journalMoney(line.cents,locale,currency)}</Text>)}
      </>}
    </>}
    {data&&<>
      {data.transaction&&<View style={{gap:8,paddingVertical:12}}>
        <Text style={styles.h2}>{transactionLabel(data.transaction,locale)}</Text>
        <Text style={styles.text}>{transactionPerson(data.transaction,locale)}</Text>
        <Text style={[styles.h2,{color:transactionAmount(data.transaction)<0n?colors.red:colors.green}]}>{transactionAmount(data.transaction)>0n?'+':''}{journalMoney(transactionAmount(data.transaction).toString(),locale,currency)}</Text>
        <Text style={styles.muted}>{data.transaction.paid_at?.slice(0,10)??t('journalNotPaid')}</Text>
      </View>}
      <Button label={technical?(locale==='ru'?'Скрыть технические подробности':'Hide technical details'):(locale==='ru'?'Технические подробности':'Technical details')} onPress={()=>setTechnical(value=>!value)}/>
      {technical&&<>
      <Text selectable style={styles.text}>{t('journalOrder')}: {data.source.order_id}</Text>
      {data.transaction?<Text selectable style={styles.muted}>{t('journalEntry')}: {data.transaction.id}</Text>:<Notice text={t('eventsNoPosting')}/>}
      {data.transaction?.entries.map((line,index)=><Text key={index} style={styles.text}>
        {t(({clearing:'journalClearing',receipts:'journalReceipts',refunds:'journalRefunds',parts_cost:'journalPartsCost',parts_payable:'journalPartsPayable',fees:'journalFees',expenses:'journalExpenses',transfers:'journalTransfers'} as const)[line.code])}
        {' · '}{t(BigInt(line.cents)>0n?'journalDebit':'journalCredit')}{' · '}{journalMoney((BigInt(line.cents)<0n?-BigInt(line.cents):BigInt(line.cents)).toString(),locale,currency)}
      </Text>)}
      <Text accessibilityRole="header" style={styles.h2}>{t('provenanceSource')}</Text>
      <EventSummary event={data.source} onOpen={onOpen}/>
      {data.reference&&<><Text accessibilityRole="header" style={styles.h2}>{t('provenanceReference')}</Text><EventSummary event={data.reference} onOpen={onOpen}/></>}
      {data.source.reference_id&&!data.reference&&<Notice text={t('eventsMissingReference')}/>}
      <Text accessibilityRole="header" style={styles.h2}>{t('provenanceAudit')}</Text>
      {data.audit.map((entry,index)=><Text key={index} style={styles.muted}>{journalDate(entry.recorded_at,locale)} · {t(entry.action==='applied'?'provenanceApplied':'provenanceReview')}</Text>)}
      {data.audit.length===0&&<Notice text={t('provenanceNoAudit')}/>}
      {data.audit_truncated&&<Notice text={t('provenanceAuditLimit')}/>}
      <Text accessibilityRole="header" style={styles.h2}>{t('provenanceHistory')}</Text>
      <Text style={styles.muted}>{t('page')} {request.cursors.length} · {t('provenanceHistoryHint')}</Text>
      {data.history.map(event=><EventSummary key={event.id} event={event} onOpen={onOpen}/>)}
      <Text style={styles.muted}>{t(data.next_revision?'journalMore':'journalEnd')}</Text>
      </>}
    </>}
    {technical&&<View style={styles.row}>
      <Button label={t('previous')} disabled={busy||request.cursors.length===1} onPress={()=>setRequest(current=>({...current,cursors:current.cursors.slice(0,-1)}))}/>
      <Button label={t('next')} disabled={busy||!data?.next_revision} onPress={()=>{if(data?.next_revision)setRequest(current=>({...current,cursors:[...current.cursors,data.next_revision]}));}}/>
    </View>}
  </Card>;
}
