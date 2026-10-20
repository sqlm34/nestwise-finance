import React,{useState} from 'react';
import {ActivityIndicator,Text,TextInput,View} from 'react-native';
import {Card,Button,Notice,SearchField,styles,colors} from './ui';
import {useApp} from '../state';
import {journalCodes,journalDate,journalMoney,type JournalPage,type JournalCode} from '../domain/journal';
import {defaultJournalFilters,filterJournal} from '../domain/journal-filters';
import type {MessageKey} from '../i18n';
const labels:Record<JournalCode,MessageKey>={
  clearing:'journalClearing',receipts:'journalReceipts',refunds:'journalRefunds',
  parts_cost:'journalPartsCost',parts_payable:'journalPartsPayable',fees:'journalFees',
};
export function AccountJournal({name,currency,page,busy,onRefresh}:{
  name:string;currency:string;page:JournalPage|null;busy:boolean;onRefresh:()=>void;
}) {
  const {t,locale}=useApp();
  const [filters,setFilters]=useState(defaultJournalFilters);
  const filtered=filterJournal(page?.entries??[],filters);
  return <Card>
    <View style={styles.between}><Text accessibilityRole="header" style={styles.h2}>{t('journalTitle')}</Text>
      <Button label={t('journalRefresh')} disabled={busy} onPress={onRefresh}/></View>
    <Text style={styles.text}>{name} · {currency}</Text>
    <Text style={styles.muted}>{t('journalScope')}</Text>
    <Text style={styles.muted}>{t('journalFilterScope')}</Text>
    <SearchField value={filters.query} onChange={query=>setFilters(current=>({...current,query}))} placeholder={t('journalSearch')}/>
    <Text style={styles.text}>{t('journalDateRange')}</Text>
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
      <Button label={t('journalReset')} onPress={()=>setFilters(defaultJournalFilters)}/>
    </View>
    {filtered.error&&<Notice error text={t(filtered.error==='invalidDate'?'journalInvalidDate':'journalReversedRange')}/>}
    {busy&&<ActivityIndicator accessibilityLabel={t('authLoading')} color={colors.green}/>}
    {!busy&&page&&page.entries.length===0&&<Notice text={t('journalEmpty')}/>}
    {!busy&&page&&page.entries.length>0&&!filtered.error&&<>
      <Text style={styles.muted}>{t('journalShown')} {filtered.entries.length} / {page.entries.length} · {t('journalLimit')}</Text>
      {filtered.entries.length===0&&<Notice text={t('journalNoMatches')}/>}
      {filtered.entries.map(transaction=><View key={transaction.id} style={{gap:10,paddingTop:14,borderTopWidth:1,borderColor:colors.line}}>
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
        <Text selectable style={styles.muted}>{t('journalOrder')}: {transaction.source_order_id}</Text>
        <Text selectable style={styles.muted}>{t('journalEntry')}: {transaction.id}</Text>
        <Text selectable style={styles.muted}>{t('journalEvent')}: {transaction.source_event_id}</Text>
        <Text style={styles.muted}>{t('journalPostedAt')}: {journalDate(transaction.posted_at,locale)}</Text>
      </View>)}
    </>}
  </Card>;
}
