import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowDownLeft, ArrowUpRight, RotateCcw, Wrench, X } from 'lucide-react-native';
import { useApp } from '../state';
import { formatMoney } from '../domain/money';
import type { Transaction } from '../data/demo';
import { Badge, colors, styles } from './ui';

export function Transactions({ rows }: { rows: Transaction[] }) {
  const { locale, t } = useApp();
  const [detail, setDetail] = useState<Transaction | null>(null);
  return <View>
    {!rows.length && <View style={{ padding: 35, alignItems: 'center', gap: 10 }}><Text style={styles.h2}>{t('empty')}</Text><Text style={styles.muted}>{t('emptyHint')}</Text></View>}
    {rows.map((row, index) => {
      const Icon = row.kind === 'refund' ? RotateCcw : row.kind === 'part' ? Wrench : row.cents > 0 ? ArrowDownLeft : ArrowUpRight;
      return <Pressable key={row.id} accessibilityRole="button" accessibilityLabel={`${row.label[locale]}, ${formatMoney(row.cents, locale)}`} onPress={() => setDetail(row)}
        style={{ flexDirection: 'row', paddingVertical: 16, alignItems: 'center', gap: 12, borderTopWidth: index ? 1 : 0, borderColor: '#edf1ed' }}>
        <View style={{ backgroundColor: row.cents > 0 ? colors.pale : '#f4f2ed', padding: 10, borderRadius: 11 }}><Icon size={17} color={row.cents > 0 ? colors.green : '#8a8067'} /></View>
        <View style={{ flex: 1, gap: 3 }}><Text style={[styles.text, { fontWeight: '500' }]}>{row.label[locale]}</Text><Text style={[styles.muted, { fontSize: 11 }]}>{t(row.kind)} · {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(row.date + 'T12:00:00Z'))}</Text></View>
        <Text style={{ color: row.cents > 0 ? colors.green : colors.ink, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{row.cents > 0 ? '+' : ''}{formatMoney(row.cents, locale)}</Text>
      </Pressable>;
    })}
    <Modal visible={!!detail} transparent animationType="fade" onRequestClose={() => setDetail(null)}>
      <View style={{ flex: 1, backgroundColor: '#19372f66', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={[styles.card, { width: '100%', maxWidth: 460, maxHeight: '90%' }]}><ScrollView>
          <View style={styles.between}><Text style={styles.h2}>{t('detail')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={() => setDetail(null)} style={{ padding: 12 }}><X color={colors.ink} size={22} /></Pressable></View>
          {detail && <View style={{ gap: 18 }}><Badge>{t('sample')}</Badge><Text style={styles.h2}>{detail.label[locale]}</Text><Text style={styles.title}>{formatMoney(detail.cents, locale)}</Text><Text style={styles.text}>{t('date')}: {detail.date}</Text><Text style={styles.text}>{t('origin')}: {detail.source}</Text><Text style={styles.muted}>{t('demoDetail')}</Text></View>}
        </ScrollView></View>
      </View>
    </Modal>
  </View>;
}
