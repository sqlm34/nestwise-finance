import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Pressable,Text,TextInput,View} from 'react-native';
import {Card,Button,Notice,SearchField,styles,colors} from './ui';
import {useApp} from '../state';
import {journalCodes,journalDate,journalMoney,type JournalCode} from '../domain/journal';
import {defaultJournalFilters,type JournalFilters} from '../domain/journal-filters';
import {historyParams,parseHistoryPage,validateHistoryFilters,type HistoryPage} from '../domain/journal-history';
import {authenticatedFetch} from '../auth/client';
import type {MessageKey} from '../i18n';
import {JournalDetail} from './JournalDetail';
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
  const [filters,setFilters]=useState(initialFilters);
  const [selectedTransaction,setSelectedTransaction]=useState<string|null>(null);
  const [request,setRequest]=useState<HistoryRequest>({filters:initialFilters,cursors:[null],revision:0});
  const [result,setResult]=useState<{request:HistoryRequest;page:HistoryPage|null;error:MessageKey|null}|null>(null);
  const busy=result?.request!==request;
  const page=busy?null:result?.page;
  const error=busy?null:result?.error;
  const filterError=validateHistoryFilters(filters);
  const dirty=JSON.stringify(filters)!==JSON.stringify(request.filters);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{
      try {
        const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/journal${
          historyParams(request.filters,request.cursors.at(-1)!)}`,controller.signal);
        if(!active)return;
        if(response.status===401){onSessionExpired();return;}
        if(!response.ok){
          setResult({request,page:null,error:response.status===404?'journalAccessLost':response.status===400?'journalRestart':'journalUnavailable'});
          return;
        }
        const loaded=parseHistoryPage(await response.json());
        if(active)setResult({request,page:loaded,error:null});
      } catch {
        if(active)setResult({request,page:null,error:'journalUnavailable'});
      }
    })();
    return ()=>{active=false;controller.abort();};
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
    <View style={{flexDirection:'row',justifyContent:'space-between',padding:10,backgroundColor:'#f8faf9'}}><Text style={styles.label}>{locale==='ru'?'ИСТОЧНИК':'SOURCE'}</Text><Text style={styles.label}>{locale==='ru'?'СУММА':'AMOUNT'}</Text></View>
    {page?.entries.slice(0,5).map(row=>{const cash=row.entries.filter(line=>line.code==='clearing').reduce((sum,line)=>sum+BigInt(line.cents),0n);return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${t('journalOrder')} ${row.source_order_id}. ${journalMoney(cash.toString(),locale,currency)}`} onPress={()=>setSelectedTransaction(row.id)} style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12,borderTopWidth:1,borderColor:colors.line}}>
      <View style={{flex:1,gap:3}}><Text numberOfLines={1} style={styles.text}>{row.source_order_id.startsWith('manual:')?(locale==='ru'?'Ручная операция':'Manual operation'):`${t('journalOrder')} ${row.source_order_id}`}</Text><Text style={styles.muted}>{row.paid_at?.slice(0,10)??t('journalNotPaid')}</Text></View>
      <Text style={[styles.text,{fontWeight:'600',color:cash<0n?colors.red:colors.green}]}>{journalMoney(cash.toString(),locale,currency).replace(/ USD$/,'')}</Text>
    </Pressable>;})}
    <Text style={[styles.muted,{fontSize:11}]}>{locale==='ru'?'Изменение клиринга · USD · дата оплаты (UTC)':'Clearing movement · USD · payment date (UTC)'}</Text>
  </Card>;
  return <Card>
    <View style={styles.between}><Text accessibilityRole="header" style={styles.h2}>{t('journalTitle')}</Text>
      <Button label={t('journalRefresh')} disabled={busy} onPress={()=>restart(request.filters)}/></View>
    <Text style={styles.text}>{name} · {currency}</Text>
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
    {filterError&&<Notice error text={t(filterError==='invalidDate'?'journalInvalidDate':filterError==='reversedRange'?'journalReversedRange':'journalInvalidQuery')}/>}
    {dirty&&<Notice text={t('journalUnapplied')}/>}
    {error&&<Notice error text={t(error)}/>}
    {busy&&<ActivityIndicator accessibilityLabel={t('authLoading')} color={colors.green}/>}
    {page&&<>
      <Text style={styles.muted}>{t('page')} {request.cursors.length} · {t('journalShown')} {page.entries.length} · {t('journalLimit')}</Text>
      {page.entries.length===0&&<Notice text={t(emptyFiltered?'journalNoMatches':'journalEmpty')}/>}
      {page.entries.map(transaction=><View key={transaction.id} style={{gap:10,paddingTop:14,borderTopWidth:1,borderColor:colors.line}}>
        <Text style={styles.h2}>{journalDate(transaction.occurred_at,locale)}</Text>
        <Text style={styles.muted}>{t('journalPaidAt')}: {transaction.paid_at?journalDate(transaction.paid_at,locale):t('journalNotPaid')}</Text>
        {transaction.entries.map((line,index)=>{
          const amount=BigInt(line.cents);
          return <View key={`${transaction.id}:${index}`} style={styles.between}>
            <View><Text style={styles.text}>{t(labels[line.code])}</Text>
              <Text style={styles.muted}>{t(amount>=0n?'journalDebit':'journalCredit')}</Text></View>
            <Text style={[styles.text,{fontWeight:'600'}]}>{journalMoney((amount<0n?-amount:amount).toString(),locale,currency)}</Text>
          </View>;
        })}
        <Text selectable style={styles.muted}>{transaction.source_order_id.startsWith('manual:')?(locale==='ru'?'Ручная операция':'Manual operation'):t('journalOrder')}: {transaction.source_order_id}</Text>
        <Text selectable style={styles.muted}>{t('journalEntry')}: {transaction.id}</Text>
        <Text selectable style={styles.muted}>{t('journalEvent')}: {transaction.source_event_id}</Text>
        <Text style={styles.muted}>{t('journalPostedAt')}: {journalDate(transaction.posted_at,locale)}</Text>
        <Button label={t('provenanceOpen')} onPress={()=>setSelectedTransaction(transaction.id)}/>
      </View>)}
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
