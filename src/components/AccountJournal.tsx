import React,{useEffect,useState} from 'react';
import {useBackStep} from '../back-navigation';
import {ActivityIndicator,Pressable,Text,TextInput,View} from 'react-native';
import {Card,Button,Notice,SearchField,styles,colors} from './ui';
import {useApp} from '../state';
import {journalCodes,journalMoney,type JournalCode} from '../domain/journal';
import {defaultJournalFilters,type JournalFilters} from '../domain/journal-filters';
import {historyParams,parseHistoryPage,validateHistoryFilters,type HistoryPage} from '../domain/journal-history';
import {authenticatedFetch} from '../auth/client';
import type {MessageKey} from '../i18n';
import {JournalDetail} from './JournalDetail';
import {transactionLabel,transactionPerson,transactionAmount} from '../domain/transaction-label';
import {onForegroundRefresh} from '../foreground-refresh';
import {recordJournalChange} from '../domain/journal-change';
const labels:Record<JournalCode,MessageKey>={
  clearing:'journalClearing',receipts:'journalReceipts',refunds:'journalRefunds',
  parts_cost:'journalPartsCost',parts_payable:'journalPartsPayable',fees:'journalFees',expenses:'journalExpenses',transfers:'journalTransfers',
};
type HistoryRequest={filters:JournalFilters;cursors:(string|null)[];revision:number};
export function AccountJournal({name,currency,workspace,account,onSessionExpired,initialFilters=defaultJournalFilters,compact=false,onViewAll}:{
  name:string;currency:string;workspace:string;account:string;onSessionExpired:()=>void;
  initialFilters?:JournalFilters;
  compact?:boolean;onViewAll?:()=>void;
}) {
  const {t,locale}=useApp();
  const [showFilters,setShowFilters]=useState(false);
  const [filters,setFilters]=useState(initialFilters);
  const [selectedTransaction,setSelectedTransaction]=useState<string|null>(null);
  const [request,setRequest]=useState<HistoryRequest>({filters:initialFilters,cursors:[null],revision:0});
  const [result,setResult]=useState<{request:HistoryRequest;page:HistoryPage|null;error:MessageKey|null}|null>(null);
  const busy=result?.request!==request;
  const page=busy?null:result?.page;
  const error=busy?null:result?.error;
  const filterError=validateHistoryFilters(filters);
  const dirty=JSON.stringify(filters)!==JSON.stringify(request.filters);
  useBackStep(showFilters&&!selectedTransaction,()=>setShowFilters(false),20);
  useEffect(()=>{
    const controller=new AbortController();let active=true,loading=false;
    const load=async(silent=false)=>{
      if(loading)return;loading=true;
      try {
        const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/journal${
          historyParams(request.filters,request.cursors.at(-1)!)}`,controller.signal);
        if(!active)return;
        if(response.status===401){onSessionExpired();return;}
        if(!response.ok){
          if(silent&&response.status>=500){setResult(current=>current?.request===request?{...current,error:'journalUnavailable'}:current);return;}
          setResult({request,page:null,error:response.status===404?'journalAccessLost':response.status===400?'journalRestart':'journalUnavailable'});
          return;
        }
        const loaded=parseHistoryPage(await response.json());
        if(active){setResult({request,page:loaded,error:null});recordJournalChange(workspace,account,loaded.entries.map(row=>`${row.id}:${row.source_event_id}`).join('|'));}
      } catch {
        if(active)setResult(current=>silent?(current?.request===request?{...current,error:'journalUnavailable'}:current):{request,page:null,error:'journalUnavailable'});
      }finally{loading=false;}
    };
    void load();
    // Keep the current cursor and filters; do not jump back while browsing history.
    const stop=onForegroundRefresh(()=>{void load(true);});
    return ()=>{active=false;stop();controller.abort();};
  },[workspace,account,request,onSessionExpired]);
  const restart=(next:JournalFilters)=>setRequest(current=>({filters:next,cursors:[null],revision:current.revision+1}));
  const emptyFiltered=!!(request.filters.query||request.filters.from||request.filters.to||request.filters.code!=='all');
  if(selectedTransaction)return <JournalDetail key={selectedTransaction} workspace={workspace} account={account}
    transaction={selectedTransaction} currency={currency} name={name} onOpen={setSelectedTransaction} onSessionExpired={onSessionExpired}
    onClose={()=>{setSelectedTransaction(null);setRequest(current=>({...current,revision:current.revision+1}));}}/>;
  if(compact)return <Card>
    <View style={styles.between}><Text style={styles.h2}>{locale==='ru'?'Операции':'Transactions'}</Text>{onViewAll&&<Button label={t('viewAll')} onPress={onViewAll}/>}</View>
    {busy&&<ActivityIndicator color={colors.green} accessibilityLabel={t('authLoading')}/>}
    {error&&<Notice error text={t(error)}/>}
    {page?.entries.length===0&&<Text style={styles.muted}>{t('journalNoMatches')}</Text>}
    <View style={{flexDirection:'row',justifyContent:'space-between',padding:10,backgroundColor:'#f8faf9'}}><Text style={styles.label}>{locale==='ru'?'ОПЕРАЦИЯ / КЛИЕНТ':'TRANSACTION / CUSTOMER'}</Text><Text style={styles.label}>{locale==='ru'?'СУММА':'AMOUNT'}</Text></View>
    {page?.entries.slice(0,5).map(row=>{const cash=transactionAmount(row);return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${transactionLabel(row,locale)}. ${transactionPerson(row,locale)}. ${journalMoney(cash.toString(),locale,currency)}`} onPress={()=>setSelectedTransaction(row.id)} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12,borderTopWidth:1,borderColor:colors.line}}>
      <View style={{flex:1,gap:3}}><Text style={styles.text}>{transactionLabel(row,locale)}</Text><Text style={styles.text}>{transactionPerson(row,locale)}</Text><Text style={styles.muted}>{row.paid_at?.slice(0,10)??t('journalNotPaid')}</Text></View>
      <Text style={[styles.text,{fontWeight:'600',color:cash<0n?colors.red:colors.green}]}>{cash>0n?'+':''}{journalMoney(cash.toString(),locale,currency).replace(/ USD$/,'')}</Text>
    </Pressable>;})}
    <Text style={[styles.muted,{fontSize:11}]}>{locale==='ru'?'Плюс — деньги пришли, минус — деньги ушли.':'Plus means money received; minus means money spent.'}</Text>
  </Card>;
  return <Card>
    <View style={styles.between}><Text accessibilityRole="header" style={styles.h2}>{t('journalTitle')}</Text>
      <Button label={t('journalRefresh')} disabled={busy} onPress={()=>restart(request.filters)}/></View>
    <Text style={styles.text}>{name} · {currency}</Text>
    <Button label={locale==='ru'?'Поиск и фильтры':'Search and filters'} selected={showFilters} onPress={()=>setShowFilters(value=>!value)}/>
    {showFilters&&<View style={{gap:12}}>
    <Text style={styles.muted}>{t('journalScope')}</Text>
    <Text style={styles.muted}>{t('journalFilterScope')}</Text>
    <SearchField value={filters.query} onChange={query=>setFilters(current=>({...current,query}))} placeholder={t('journalSearch')}/>
    <View style={styles.row}>
      <Button label={locale==='ru'?'По дате события':'By event date'} selected={filters.basis!=='paid'} onPress={()=>setFilters(current=>({...current,basis:'event'}))}/>
      <Button label={locale==='ru'?'По дате оплаты':'By payment date'} selected={filters.basis==='paid'} onPress={()=>setFilters(current=>({...current,basis:'paid'}))}/>
    </View>
    <Text style={styles.text}>{filters.basis==='paid'?(locale==='ru'?'Дата фактической оплаты (UTC). Операции без даты оплаты исключены.':'Actual payment date (UTC). Transactions without a payment date are excluded.'):t('journalDateRange')}</Text>
    <View style={styles.row}>
      <View style={{flexGrow:1,gap:4}}><Text style={styles.muted}>{t('journalFrom')}</Text>
        <TextInput accessibilityLabel={t('journalFrom')} placeholder="YYYY-MM-DD" value={filters.from} maxLength={10}
          autoCorrect={false} style={styles.input} onChangeText={from=>setFilters(current=>({...current,from}))}/></View>
      <View style={{flexGrow:1,gap:4}}><Text style={styles.muted}>{t('journalTo')}</Text>
        <TextInput accessibilityLabel={t('journalTo')} placeholder="YYYY-MM-DD" value={filters.to} maxLength={10}
          autoCorrect={false} style={styles.input} onChangeText={to=>setFilters(current=>({...current,to}))}/></View>
    </View>
    <Text style={styles.text}>{t('journalCodeFilter')}</Text>
    <View style={styles.row}>
      <Button label={t('allTypes')} selected={filters.code==='all'} onPress={()=>setFilters(current=>({...current,code:'all'}))}/>
      {journalCodes.map(code=><Button key={code} label={t(labels[code])} selected={filters.code===code}
        onPress={()=>setFilters(current=>({...current,code}))}/>)}
    </View>
    <View style={styles.row}>
      {(['newest','oldest'] as const).map(order=><Button key={order} label={t(order)} selected={filters.order===order}
        onPress={()=>setFilters(current=>({...current,order}))}/>)}
      <Button label={t('journalReset')} disabled={busy} onPress={()=>{setFilters(defaultJournalFilters);restart(defaultJournalFilters);}}/>
      <Button label={t('journalApply')} primary disabled={busy||!!filterError} onPress={()=>restart(filters)}/>
    </View>
    </View>}
    {filterError&&<Notice error text={t(filterError==='invalidDate'?'journalInvalidDate':filterError==='reversedRange'?'journalReversedRange':'journalInvalidQuery')}/>}
    {dirty&&<Notice text={t('journalUnapplied')}/>}
    {error&&<Notice error text={t(error)}/>}
    {busy&&<ActivityIndicator accessibilityLabel={t('authLoading')} color={colors.green}/>}
    {page&&<>
      <Text style={styles.muted}>{t('page')} {request.cursors.length} · {t('journalShown')} {page.entries.length} · {t('journalLimit')}</Text>
      {page.entries.length===0&&<Notice text={t(emptyFiltered?'journalNoMatches':'journalEmpty')}/>}
      <View>
       {page.entries.map(transaction=>{const cash=transactionAmount(transaction);return <Pressable key={transaction.id} accessibilityRole="button" accessibilityLabel={`${transactionLabel(transaction,locale)}. ${transactionPerson(transaction,locale)}. ${journalMoney(cash.toString(),locale,currency)}`} onPress={()=>setSelectedTransaction(transaction.id)} style={{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:16,borderBottomWidth:1,borderColor:colors.line}}>
        <View style={{flex:1,gap:4}}><Text style={[styles.text,{fontWeight:'600'}]}>{transactionLabel(transaction,locale)}</Text><Text style={styles.text}>{transactionPerson(transaction,locale)}</Text><Text style={[styles.muted,{fontSize:12}]}>{transaction.paid_at?.slice(0,10)??t('journalNotPaid')}</Text></View>
        <Text style={[styles.text,{textAlign:'right',fontWeight:'700',color:cash<0n?colors.red:colors.green,fontVariant:['tabular-nums']}]}>{cash>0n?'+':''}{journalMoney(cash.toString(),locale,currency).replace(/ USD$/,'')}</Text>
       </Pressable>;})}
      </View>
      <Text style={styles.muted}>{t(page.next_cursor?'journalMore':'journalEnd')}</Text>
    </>}
    <View style={styles.row}>
      <Button label={t('previous')} disabled={busy||request.cursors.length===1}
        onPress={()=>setRequest(current=>({...current,cursors:current.cursors.slice(0,-1)}))}/>
      <Button label={t('next')} disabled={busy||!page?.next_cursor}
        onPress={()=>{if(page?.next_cursor)setRequest(current=>({...current,cursors:[...current.cursors,page.next_cursor]}));}}/>
    </View>
    <Text style={styles.muted}>{t('journalLiveHistory')}</Text>
  </Card>;
}
