import React from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {Card,Button,Notice,styles,colors} from './ui';
import {useApp} from '../state';
import {journalDate,journalMoney,type JournalPage,type JournalCode} from '../domain/journal';
import type {MessageKey} from '../i18n';
const labels:Record<JournalCode,MessageKey>={
  clearing:'journalClearing',receipts:'journalReceipts',refunds:'journalRefunds',
  parts_cost:'journalPartsCost',parts_payable:'journalPartsPayable',fees:'journalFees',
};
export function AccountJournal({name,currency,page,busy,onRefresh}:{
  name:string;currency:string;page:JournalPage|null;busy:boolean;onRefresh:()=>void;
}) {
  const {t,locale}=useApp();
  return <Card>
    <View style={styles.between}><Text accessibilityRole="header" style={styles.h2}>{t('journalTitle')}</Text>
      <Button label={t('journalRefresh')} disabled={busy} onPress={onRefresh}/></View>
    <Text style={styles.text}>{name} · {currency}</Text>
    <Text style={styles.muted}>{t('journalScope')}</Text>
    {busy&&<ActivityIndicator accessibilityLabel={t('authLoading')} color={colors.green}/>}
    {!busy&&page&&page.entries.length===0&&<Notice text={t('journalEmpty')}/>}
    {page&&page.entries.length>0&&<>
      <Text style={styles.muted}>{t('journalShown')} {page.entries.length} · {t('journalLimit')}</Text>
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
        <Text selectable style={styles.muted}>{t('journalOrder')}: {transaction.source_order_id}</Text>
        <Text selectable style={styles.muted}>{t('journalEntry')}: {transaction.id}</Text>
        <Text style={styles.muted}>{t('journalPostedAt')}: {journalDate(transaction.posted_at,locale)}</Text>
      </View>)}
    </>}
  </Card>;
}
