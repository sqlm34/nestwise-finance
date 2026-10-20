import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,TextInput,View} from 'react-native';
import {Button,Card,Notice,styles,colors} from './ui';
import {useApp} from '../state';
import {authenticatedFetch} from '../auth/client';
import {journalDate,journalCodes,type JournalCode} from '../domain/journal';
import {defaultJournalFilters,type JournalFilters} from '../domain/journal-filters';
import {metricKeys,periodPreset,validatePeriod,parsePeriodInsights,periodMetrics,insightMoney,type Period,type PeriodInsights,type Metric} from '../domain/period-insights';
import {AccountJournal} from './AccountJournal';
import type {MessageKey} from '../i18n';
const labels:Record<Metric,MessageKey>={receipts:'insightsReceipts',refunds:'journalRefunds',net_receipts:'insightsNetReceipts',parts_cost:'insightsParts',fees:'journalFees',recorded_difference:'insightsDifference',clearing:'insightsClearing',parts_payable:'insightsPayable'};
export function AccountInsights({workspace,account,name,currency,onSessionExpired,onEvents}:{workspace:string;account:string;name:string;currency:string;onSessionExpired:()=>void;onEvents:()=>void}){
  const {t,locale}=useApp();
  const [period,setPeriod]=useState<Period>(()=>periodPreset('month'));
  const [request,setRequest]=useState(()=>({period,revision:0}));
  const [result,setResult]=useState<{request:typeof request;data:PeriodInsights|null;error:MessageKey|null}|null>(null);
  const [drill,setDrill]=useState<JournalFilters|null>(null);
  const busy=result?.request!==request,data=busy?null:result?.data;
  let invalid=false;try{validatePeriod(period);}catch{invalid=true;}
  const dirty=period.from!==request.period.from||period.to!==request.period.to;
  const apply=(next:Period)=>setRequest(current=>({period:next,revision:current.revision+1}));
  const openJournal=(range:Period,code:JournalCode|'all'='all')=>setDrill({...defaultJournalFilters,...range,code});
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/insights?${new URLSearchParams(request.period)}`,controller.signal);
      if(!active)return;
      if(response.status===401){onSessionExpired();return;}
      if(!response.ok){setResult({request,data:null,error:response.status===404?'journalAccessLost':response.status===400?'insightsInvalidPeriod':'journalUnavailable'});return;}
      const loaded=parsePeriodInsights(await response.json(),request.period);
      if(active)setResult({request,data:loaded,error:null});
    }catch{if(active)setResult({request,data:null,error:'journalUnavailable'});}})();
    return()=>{active=false;controller.abort();};
  },[workspace,account,request,onSessionExpired]);
  if(drill)return <>
    <Button label={t('insightsBack')} onPress={()=>{setDrill(null);apply(request.period);}}/>
    <Notice text={t('insightsDrillHint')}/>
    <AccountJournal key={`${drill.from}:${drill.to}:${drill.code}`} workspace={workspace} account={account} name={name} currency={currency} initialFilters={drill} onSessionExpired={onSessionExpired}/>
  </>;
  const metrics=data?periodMetrics(data.current):null,prior=data?periodMetrics(data.previous):null;
  return <Card>
    <Text accessibilityRole="header" style={styles.h2}>{t('insightsTitle')}</Text>
    <Text style={styles.text}>{name} · {currency}</Text>
    <Notice text={t('insightsScope')}/>
    <View style={styles.row}>{(['month','quarter','year'] as const).map(kind=><Button key={kind} label={t(({month:'insightsMonth',quarter:'insightsQuarter',year:'insightsYear'} as const)[kind])}
      disabled={busy} onPress={()=>{const next=periodPreset(kind);setPeriod(next);apply(next);}}/>)}</View>
    <Text style={styles.muted}>{t('insightsDateBasis')}</Text>
    <View style={styles.row}>
      <View style={{flexGrow:1,gap:4}}><Text style={styles.muted}>{t('journalFrom')}</Text>
        <TextInput accessibilityLabel={t('journalFrom')} value={period.from} maxLength={10} style={styles.input} autoCorrect={false} onChangeText={from=>setPeriod(current=>({...current,from}))}/></View>
      <View style={{flexGrow:1,gap:4}}><Text style={styles.muted}>{t('journalTo')}</Text>
        <TextInput accessibilityLabel={t('journalTo')} value={period.to} maxLength={10} style={styles.input} autoCorrect={false} onChangeText={to=>setPeriod(current=>({...current,to}))}/></View>
    </View>
    <View style={styles.row}>
      <Button label={t('journalApply')} primary disabled={busy||invalid} onPress={()=>apply(period)}/>
      <Button label={t('insightsRefresh')} disabled={busy} onPress={()=>apply(request.period)}/>
    </View>
    {invalid&&<Notice error text={t('insightsInvalidPeriod')}/>}
    {dirty&&<Notice text={t('journalUnapplied')}/>}
    {busy&&<ActivityIndicator color={colors.green} accessibilityLabel={t('authLoading')}/>}
    {!busy&&result?.error&&<Notice error text={t(result.error)}/>}
    {data&&metrics&&prior&&<>
      <Text style={styles.h2}>{data.current.from} — {data.current.to}</Text>
      <Text style={styles.muted}>{t('insightsPrevious')}: {data.previous.from} — {data.previous.to}</Text>
      <Text style={styles.muted}>{t('insightsCalculated')}: {journalDate(data.generated_at,locale)}</Text>
      <Text style={styles.text}>{t('insightsTransactions')}: {data.current.transaction_count} · {t('insightsPrevious')}: {data.previous.transaction_count}</Text>
      {data.current.transaction_count==='0'&&<Notice text={t('insightsEmpty')}/>}
      <Text accessibilityRole="header" style={styles.h2}>{t('insightsQuality')}</Text>
      <Notice text={t('insightsCoverage')}/>
      <Text style={styles.text}>{t('provenanceWaiting')}: {data.attention.waiting} · {t('provenanceReview')}: {data.attention.needs_review}</Text>
      <Text style={styles.muted}>{t('insightsAttentionScope')}</Text>
      <Text style={styles.text}>{t('insightsMissingPaid')}: {data.current.missing_paid_date}</Text>
      <Button label={t('eventsTitle')} onPress={onEvents}/>
      {metricKeys.map(metric=><View key={metric} style={{gap:6,paddingVertical:12,borderTopWidth:1,borderColor:colors.line}}>
        <Text style={styles.h2}>{t(labels[metric])}</Text><Text style={styles.title}>{insightMoney(metrics[metric],locale)}</Text>
        <Text style={styles.muted}>{t('insightsPrevious')}: {insightMoney(prior[metric],locale)} · {t('insightsChange')}: {insightMoney(metrics[metric]-prior[metric],locale)}</Text>
        {journalCodes.includes(metric as JournalCode)&&<Button label={t('insightsShowLines')} onPress={()=>openJournal(data.current,metric as JournalCode)}/>}
      </View>)}
      <Notice text={t('insightsFormula')}/>
      <Button label={t('insightsAllLines')} onPress={()=>openJournal(data.current)}/>
      <Button label={t('insightsPreviousLines')} onPress={()=>openJournal(data.previous)}/>
      <Text accessibilityRole="header" style={styles.h2}>{t('insightsMonths')}</Text>
      {data.months.map(month=>{const values=periodMetrics(month);return <View key={month.from} style={{gap:8,paddingVertical:12,borderTopWidth:1,borderColor:colors.line}}>
        <Text style={styles.h2}>{month.from} — {month.to}</Text>
        <Text style={styles.muted}>{t('insightsTransactions')}: {month.transaction_count}</Text>
        {(['receipts','refunds','parts_cost','fees','recorded_difference'] as const).map(metric=><Text key={metric} style={styles.text}>{t(labels[metric])}: {insightMoney(values[metric],locale)}</Text>)}
        <Button label={t('insightsAllLines')} onPress={()=>openJournal(month)}/>
      </View>;})}
      <Text style={styles.muted}>{t('insightsLive')}</Text>
    </>}
  </Card>;
}
