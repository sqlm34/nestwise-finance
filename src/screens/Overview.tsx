import React, { useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, FileUp, Leaf, ReceiptText, RotateCcw, Wrench } from 'lucide-react-native';
import { useApp } from '../state';
import { demoTransactions } from '../data/demo';
import { sumCents, formatMoney } from '../domain/money';
import { Shell, navigate } from '../components/Shell';
import { Badge, Button, Card, colors, styles } from '../components/ui';
import { Transactions } from '../components/Transactions';
import type { MessageKey } from '../i18n';

export default function Overview() {
  const { t, locale, workspace } = useApp();
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');
  const { width } = useWindowDimensions();
  const rows = demoTransactions.filter(row => row.workspace === workspace && (period === 'all' || row.date.startsWith(period === 'month' ? '2026-10' : '2026')));
  const total = (kind: string) => sumCents(rows.filter(row => row.kind === kind).map(row => row.cents));
  const metrics: { label: MessageKey; value: number; icon: typeof Leaf }[] = workspace === 'business' ? [
    { label: 'revenue', value: total('payment'), icon: ArrowDownLeft },
    { label: 'refunds', value: -total('refund'), icon: RotateCcw },
    { label: 'parts', value: -total('part'), icon: Wrench },
    { label: 'result', value: sumCents(rows.filter(r => r.kind !== 'transfer').map(r => r.cents)), icon: Leaf },
  ] : [
    { label: 'income', value: total('salary'), icon: ArrowDownLeft },
    { label: 'expenses', value: -total('expense'), icon: ArrowUpRight },
    { label: 'transfers', value: total('transfer'), icon: ArrowRight },
    { label: 'balance', value: sumCents(rows.filter(r => r.kind !== 'transfer').map(r => r.cents)), icon: Leaf },
  ];
  return <Shell title="overview" actions={<Button primary label={t('import')} icon={<FileUp size={16} color="white" />} onPress={() => navigate('bank')} />}>
    <View style={styles.between}><Text style={[styles.h2, { fontSize: 17 }]}>{t('welcome')}</Text><View style={styles.row}>{(['month', 'year', 'all'] as const).map(p => <Button key={p} label={t(p)} selected={p === period} onPress={() => setPeriod(p)} />)}</View></View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
      {metrics.map(({ label, value, icon: Icon }, index) => <Card key={label} style={{ flexGrow: 1, flexBasis: width < 550 ? '44%' : 190, minWidth: 140, backgroundColor: index === 3 ? '#193f33' : '#fff', borderColor: index === 3 ? '#193f33' : colors.line }}>
        <View style={styles.between}><Icon color={index === 3 ? '#a6d4b8' : colors.green} size={18} /><Text style={{ color: index === 3 ? '#a6d4b8' : colors.muted, fontSize: 10 }}>{t('sample')}</Text></View>
        <Text style={[styles.muted, { color: index === 3 ? '#c8dfd0' : colors.muted }]}>{t(label)}</Text>
        <Text style={{ color: index === 3 ? '#fff' : colors.ink, fontSize: width < 550 ? 23 : 29, letterSpacing: -1, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{formatMoney(value, locale)}</Text>
      </Card>)}
    </View>
    <Text style={[styles.muted, { fontSize: 11, marginTop: -12 }]}>{t('noBankBalance')}</Text>
    <View style={{ flexDirection: width >= 1200 ? 'row' : 'column', gap: 20 }}>
      <Card style={{ flex: 1.7 }}><View style={styles.between}><Text style={styles.h2}>{t('recent')}</Text><Button label={t('viewAll')} onPress={() => navigate('transactions')} icon={<ArrowRight size={14} color={colors.green} />} /></View><Transactions key={workspace} rows={rows.slice(0, 5)} /></Card>
      <View style={{ flex: 1, gap: 20 }}>
        <Card><View style={styles.row}><ReceiptText size={19} color={colors.green} /><Text style={styles.h2}>{t('ready')}</Text></View>
          {(['step1', 'step2', 'step3'] as const).map((step, index) => <View key={step} style={{ flexDirection: 'row', gap: 12, paddingVertical: 8 }}><View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.pale, justifyContent: 'center', alignItems: 'center' }}><Text style={{ color: colors.green, fontSize: 12 }}>{index + 1}</Text></View><View style={{ flex: 1, gap: 4 }}><Text style={[styles.text, { fontWeight: '600' }]}>{t(step)}</Text><Text style={styles.muted}>{t(`${step}Hint`)}</Text></View></View>)}
        </Card>
        <Card style={{ backgroundColor: '#eef4ee' }}><Badge warning>{t('notConnected')}</Badge><Text style={styles.h2}>Alex CRM → Nestwise</Text><Text style={styles.muted}>{t('crmDescription')}</Text><Button label={t('crm')} onPress={() => navigate('crm')} /></Card>
      </View>
    </View>
  </Shell>;
}
