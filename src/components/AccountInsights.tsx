import React,{useEffect,useState} from 'react';
import {useBackStep} from '../back-navigation';
import {ActivityIndicator,Pressable,Text,TextInput,View,useWindowDimensions} from 'react-native';
import {Button,Card,Notice,styles,colors} from './ui';
import {useApp} from '../state';
import {authenticatedFetch} from '../auth/client';
import {journalDate,journalCodes,type JournalCode} from '../domain/journal';
import {defaultJournalFilters,type JournalFilters} from '../domain/journal-filters';
import {metricKeys,periodPreset,validatePeriod,parsePeriodInsights,periodMetrics,insightMoney,type Period,type PeriodInsights,type Metric} from '../domain/period-insights';
import {AccountJournal} from './AccountJournal';
import {onForegroundRefresh} from '../foreground-refresh';
import {AutomaticUpdates} from './AutomaticUpdates';
import type {MessageKey} from '../i18n';
const labels:Record<Metric,MessageKey>={receipts:'insightsReceipts',refunds:'journalRefunds',net_receipts:'insightsNetReceipts',parts_cost:'insightsParts',fees:'journalFees',recorded_difference:'insightsDifference',clearing:'insightsClearing',parts_payable:'insightsPayable',expenses:'journalExpenses',transfers:'journalTransfers'};
const primaryMetrics=['receipts','parts_cost','expenses','recorded_difference'] as const;
const compactLabels={receipts:'revenue',expenses:'journalExpenses',parts_cost:'parts',recorded_difference:'result'} as const;
export function AccountInsights({workspace,account,name,currency,onSessionExpired,onEvents,onReports,onBank,onReceipts,allowAppUpdate=false}:{workspace:string;account:string;name:string;currency:string;onSessionExpired:()=>void;onEvents:()=>void;onReports:()=>void;onBank:()=>void;onReceipts:()=>void;allowAppUpdate?:boolean}){
  const {t,locale}=useApp();
  const {width}=useWindowDimensions();
  const [details,setDetails]=useState(false);
  const [period,setPeriod]=useState<Period>(()=>periodPreset('month'));
  const [request,setRequest]=useState(()=>({period,revision:0}));
  const [result,setResult]=useState<{request:typeof request;data:PeriodInsights|null;error:MessageKey|null}|null>(null);
  const [drill,setDrill]=useState<JournalFilters|null>(null);
  const busy=result?.request!==request,data=busy?null:result?.data;
  let invalid=false;try{validatePeriod(period);}catch{invalid=true;}
  const dirty=period.from!==request.period.from||period.to!==request.period.to;
  const apply=(next:Period)=>setRequest(current=>({period:next,revision:current.revision+1}));
  const openJournal=(range:Period,code:JournalCode|'all'='all')=>setDrill({...defaultJournalFilters,...range,code,basis:'paid'});
  useBackStep(!!drill,()=>{setDrill(null);apply(request.period);});
  useBackStep(!drill&&details,()=>setDetails(false));
  useEffect(()=>{
    const controller=new AbortController();let active=true,loading=false;
    const load=async(silent=false)=>{if(loading)return;loading=true;try{
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/cash-insights?${new URLSearchParams(request.period)}`,controller.signal);
      if(!active)return;
      if(response.status===401){onSessionExpired();return;}
      if(!response.ok){if(silent&&response.status>=500){setResult(current=>current?.request===request?{...current,error:'journalUnavailable'}:current);return;}setResult({request,data:null,error:response.status===404?'journalAccessLost':response.status===400?'insightsInvalidPeriod':'journalUnavailable'});return;}
      const raw=await response.json();if(raw.basis!=='cash')throw new Error('invalid_basis');
      const loaded=parsePeriodInsights(raw,request.period);
      if(active)setResult({request,data:loaded,error:null});
    }catch{if(active)setResult(current=>silent?(current?.request===request?{...current,error:'journalUnavailable'}:current):{request,data:null,error:'journalUnavailable'});}finally{loading=false;}};
    void load();const stop=onForegroundRefresh(()=>{void load(true);});
    return()=>{active=false;stop();controller.abort();};
  },[workspace,account,request,onSessionExpired]);
  if(drill)return <>
    <Button label={t('insightsBack')} onPress={()=>{setDrill(null);apply(request.period);}}/>
    <Notice text={t('insightsDrillHint')}/>
    <AccountJournal key={`${drill.from}:${drill.to}:${drill.code}`} workspace={workspace} account={account} name={name} currency={currency} initialFilters={drill} onSessionExpired={onSessionExpired}/>
  </>;
  const metrics=data?periodMetrics(data.current):null,prior=data?periodMetrics(data.previous):null;
  return <View style={{gap:20}}>
    <AutomaticUpdates canApply={allowAppUpdate&&!details&&!dirty&&!busy}/>
    <View style={[styles.row,{gap:8}]}>{(['month','year'] as const).map(kind=><Button key={kind} label={t(kind)} disabled={busy} onPress={()=>{const next=periodPreset(kind);setPeriod(next);apply(next);}}/>)}<Button label={locale==='ru'?'Отчёт для бухгалтера':'Accountant report'} onPress={onReports}/><Button primary label={locale==='ru'?'Импортировать выписку':'Import statement'} onPress={onBank}/></View>
    <View style={{padding:12,borderRadius:11,backgroundColor:'#fff6e7',borderWidth:1,borderColor:'#f0dec0'}}><Text style={{fontSize:12,color:'#976018'}}>{locale==='ru'?'Не учитывайте повторно доходы и расходы CRM при загрузке банковской выписки.':'Do not double count CRM revenue, expenses and bank evidence.'}</Text></View>
    {data&&metrics&&prior&&<>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:width<=720?9:14}}>{primaryMetrics.map(metric=>{return <Pressable key={metric} accessibilityRole="button" accessibilityLabel={`${t(labels[metric])}: ${insightMoney(metrics[metric],locale)}. ${t('insightsShowLines')}`} onPress={()=>openJournal(data.current,journalCodes.includes(metric as JournalCode)?metric as JournalCode:'all')} style={{flexBasis:width<=1020?'44%':'22%',flexGrow:1,minWidth:130,gap:10,padding:width<=720?15:21,borderRadius:17,borderWidth:1,borderColor:colors.line,backgroundColor:'#fff'}}>
        <Text style={[styles.muted,{color:colors.muted}]}>{metric==='recorded_difference'?(locale==='ru'?'Операционный результат':'Operating result'):t(compactLabels[metric])}</Text>
        <Text adjustsFontSizeToFit minimumFontScale={0.7} numberOfLines={1} style={{fontSize:width<=720?22:27,fontWeight:'800',letterSpacing:-1,fontVariant:['tabular-nums'],color:colors.ink}}>{insightMoney(metrics[metric],locale).replace(/ USD$/,'')}</Text>
        <Text style={{fontSize:11,color:'#81928a'}}>{currency} · {data.current.from} — {data.current.to}</Text>
      </Pressable>;})}</View>
      <Text style={[styles.muted,{fontSize:11}]}>{locale==='ru'?'По проведённым операциям. Результат — разница поступлений и учтённых расходов, не остаток банка.':'Posted transactions only. Result is receipts less recorded expenses, not a bank balance.'}</Text>
      <View style={{flexDirection:width>1020?'row':'column',gap:14}}>
       <View style={{flex:1.25}}><AccountJournal compact key={`${request.period.from}:${request.period.to}:${request.revision}`} workspace={workspace} account={account} name={name} currency={currency} onSessionExpired={onSessionExpired} initialFilters={{...defaultJournalFilters,...request.period,basis:'paid'}} onViewAll={()=>openJournal(data.current)}/></View>
       <View style={{flex:1}}><Card><Text style={styles.h2}>{locale==='ru'?'Единая финансовая система':'Finance that stays in sync'}</Text>
        {[
          {label:locale==='ru'?'CRM: оплаты и корректировки':'CRM: finalized payments + corrections',action:onEvents},
          {label:locale==='ru'?'Банк: импорт выписки и сверка':'Bank: statement import and match',action:onBank},
          {label:locale==='ru'?'OCR: проверка чека и категория':'OCR: review expense and map category',action:onReceipts},
          {label:locale==='ru'?'Бухгалтер: подготовка и экспорт PDF':'Accountant: prepare and export PDF',action:onReports},
        ].map((step,index)=><Pressable key={index} accessibilityRole="button" accessibilityLabel={step.label} onPress={step.action} style={{flexDirection:'row',gap:11,alignItems:'center',paddingVertical:12,borderBottomWidth:1,borderColor:'#ecf0ed'}}><View style={{width:28,height:28,borderRadius:14,backgroundColor:'#e6f6ed',alignItems:'center',justifyContent:'center'}}><Text style={{color:'#18835e',fontWeight:'700'}}>{index+1}</Text></View><Text style={[styles.muted,{flex:1}]}>{step.label}</Text></Pressable>)}
        <Text style={styles.muted}>{t('provenanceWaiting')}: {data.attention.waiting} · {t('provenanceReview')}: {data.attention.needs_review}</Text>
       </Card></View>
      </View>
    </>}
    {busy&&<ActivityIndicator color={colors.green} accessibilityLabel={t('authLoading')}/>}
    {!busy&&result?.error&&<Notice error text={t(result.error)}/>}
    <Button label={details?(locale==='ru'?'Скрыть подробности':'Hide details'):(locale==='ru'?'Подробности и свой период':'Details and custom dates')} selected={details} onPress={()=>setDetails(value=>!value)}/>
    {details&&<Card>
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
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:14}}>{metricKeys.filter(metric=>!(primaryMetrics as readonly Metric[]).includes(metric)).map(metric=><View key={metric} style={{gap:8,padding:20,borderWidth:1,borderRadius:14,borderColor:colors.line,flexBasis:260,flexGrow:1,backgroundColor:metric==='recorded_difference'?colors.pale:'#fff'}}>
        <Text style={styles.h2}>{t(labels[metric])}</Text><Text style={styles.title}>{insightMoney(metrics[metric],locale)}</Text>
        <Text style={styles.muted}>{t('insightsPrevious')}: {insightMoney(prior[metric],locale)} · {t('insightsChange')}: {insightMoney(metrics[metric]-prior[metric],locale)}</Text>
        {journalCodes.includes(metric as JournalCode)&&<Button label={t('insightsShowLines')} onPress={()=>openJournal(data.current,metric as JournalCode)}/>}
      </View>)}</View>
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
    </Card>}
  </View>;
}
