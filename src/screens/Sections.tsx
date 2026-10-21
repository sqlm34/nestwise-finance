import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Link2, ShieldCheck } from 'lucide-react-native';
import { useApp } from '../state';
import { demoTransactions, eventLabels } from '../data/demo';
import categories from '../data/accountant-categories.json';
import { Transactions } from '../components/Transactions';
import { Shell, navigate } from '../components/Shell';
import { Badge, Button, Card, colors, Notice, SearchField, styles } from '../components/ui';
import type { MessageKey } from '../i18n';

export function TransactionsScreen() {
  const { t, locale, workspace } = useApp();
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'allTypes' | 'payment' | 'expense' | 'refund' | 'part' | 'salary' | 'transfer'>('allTypes');
  const [sort, setSort] = useState<'newest' | 'oldest' | 'biggest'>('newest');
  const [period, setPeriod] = useState<'month' | 'year' | 'all'>('month');
  const rows = demoTransactions.filter(row => row.workspace === workspace
    && (period === 'all' || row.date.startsWith(period === 'month' ? '2026-10' : '2026'))
    && (kind === 'allTypes' || row.kind === kind)
    && `${row.label[locale]} ${row.source} ${t(row.kind)}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === 'biggest' ? Math.abs(b.cents) - Math.abs(a.cents) : sort === 'newest' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date));
  return <Shell title="transactions"><Card>
    <SearchField value={search} onChange={setSearch} placeholder={t('search')} />
    <View style={styles.row}>{(['allTypes', 'payment', 'expense', 'refund', 'part', 'salary', 'transfer'] as const).map(key => <Button key={key} label={t(key)} selected={kind === key} onPress={() => setKind(key)} />)}</View>
    <View style={styles.between}><View style={styles.row}>{(['month', 'year', 'all'] as const).map(key => <Button key={key} label={t(key)} selected={period === key} onPress={() => setPeriod(key)} />)}</View><Button label={t(sort)} onPress={() => setSort(sort === 'newest' ? 'oldest' : sort === 'oldest' ? 'biggest' : 'newest')} /></View>
    <Transactions key={workspace} rows={rows} />
  </Card></Shell>;
}
export function CrmScreen() {
  const { t } = useApp();
  return <Shell title="crm"><Card><View style={styles.between}><View style={styles.row}><Link2 size={24} color={colors.green} /><Text style={styles.h2}>Alex Appliance Repair CRM</Text></View><Badge warning>{t('notConnected')}</Badge></View><Text style={styles.text}>{t('crmDescription')}</Text><Notice text={t('crmBoundary')} /><Text style={styles.h2}>{t('delivery')}</Text><Text style={styles.muted}>{t('deliveryText')}</Text></Card>
    <Card><Text style={styles.h2}>{t('events')}</Text>{eventLabels.map((label, i) => <View key={label} style={[styles.row, { paddingVertical: 10 }]}><Badge>{String(i + 1).padStart(2, '0')}</Badge><Text style={styles.text}>{t(label)}</Text></View>)}</Card>
    <Card><View style={styles.row}><ShieldCheck size={22} color={colors.green} /><Text style={styles.h2}>{t('immutable')}</Text></View><Text style={styles.muted}>{t('immutableHint')}</Text><Text style={styles.muted}>{t('excluded')}</Text></Card>
  </Shell>;
}
export function MappingScreen() {
  const { t, locale } = useApp(); const [search, setSearch] = useState('');
  const rows = categories.categories.filter(row => `${row.id} ${row.en} ${row.ru}`.toLowerCase().includes(search.toLowerCase()));
  return <Shell title="mapping"><Notice text={t('mappingHint')} /><Card><View style={styles.between}><Text style={styles.h2}>{t('categories')}</Text><Badge warning>{t('approval')}</Badge></View><SearchField value={search} onChange={setSearch} placeholder={t('categorySearch')} />
    {rows.map(row => <View key={row.id} style={{ paddingVertical: 12, borderBottomColor: colors.line, borderBottomWidth: 1, gap: 5 }}><View style={styles.between}><Text style={[styles.text, { fontWeight: '600' }]}>{row[locale]}</Text><Badge>{row.id}</Badge></View>{locale === 'ru' && <Text style={styles.muted}>{t('originalLabel')}: {row.en}</Text>}</View>)}
    {!rows.length && <Text style={styles.muted}>{t('noResults')}</Text>}
  </Card></Shell>;
}
export function SettingsScreen() {
  const { t, locale, setLocale, preferenceError } = useApp();
  const sections: [MessageKey, MessageKey][] = [['privacy', 'privacyHint'], ['accountScope', 'accountScopeHint'], ['stage', 'stageHint']];
  return <Shell title="settings"><Card><Text style={styles.h2}>{t('language')}</Text><Text style={styles.muted}>{t('languageHint')}</Text><View style={styles.row}><Button label="English" selected={locale === 'en'} onPress={() => setLocale('en')} /><Button label="Русский" selected={locale === 'ru'} onPress={() => setLocale('ru')} /></View>{preferenceError && <Notice error text={t('settingsError')} />}</Card>
    {sections.map(([title, body]) => <Card key={title}><Text style={styles.h2}>{t(title)}</Text><Text style={styles.muted}>{t(body)}</Text></Card>)}
  </Shell>;
}
export function ReconciliationScreen() {
  const { t, previews, workspace } = useApp(); const file = previews[workspace];
  return <Shell title="reconcile"><Notice text={t('reconciliationHint')} /><Card>
    <Text style={styles.h2}>{file ? file.name : t('noStatements')}</Text>
    {file && <><Badge warning>{t('unmatched')}: {file.preview.rows.length}</Badge><Text style={styles.muted}>{file.preview.accountAlias}</Text><Text style={styles.muted}>{t('noPosting')}</Text></>}
    <Button primary label={t('openImport')} onPress={() => navigate('bank')} />
  </Card></Shell>;
}
