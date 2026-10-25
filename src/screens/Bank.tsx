import React, { useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import {readStatementFile} from '../statement-file';
import { FileSpreadsheet, FileUp, ShieldCheck } from 'lucide-react-native';
import { useApp } from '../state';
import { previewStatement, sampleStatement, type Bank as BankId } from '../domain/statement';
import { formatMoney } from '../domain/money';
import { Button, Card, Notice, SearchField, Badge, colors, styles } from '../components/ui';
import { Shell } from '../components/Shell';
import { messages, type MessageKey } from '../i18n';

export default function Bank() {
  const { t, locale, workspace, previews, savePreview } = useApp();
  const [bank, setBank] = useState<BankId>('chase');
  const [alias, setAlias] = useState('');
  const [error, setError] = useState<MessageKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(0);
  const mounted = useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const active = previews[workspace];
  async function load(sample: boolean) {
    const destination = workspace;
    setError(null); setBusy(true);
    try {
      const loaded=await readStatementFile(sample?sampleStatement:undefined);
      if(!loaded)return;
      const {name,hash,text}=loaded;
      if (previews[destination]?.hash === hash) throw new Error('duplicateFile');
      const preview = previewStatement(text, sample ? 'chase' : bank, sample ? 'Demo · 1234' : alias);
      if (mounted.current) { savePreview(destination, { name, hash, preview, sample }); setPage(0); }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (mounted.current) setError(message in messages.en ? message as MessageKey : 'importError');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  const issues = active ? active.preview.errors.length + active.preview.rows.filter(row => row.issues.length).length : 0;
  const visibleRows = active?.preview.rows.filter(row => (!onlyIssues || row.issues.length) && `${row.description} ${row.date}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / 50));
  const currentPage = Math.min(page, pageCount - 1);
  return <Shell title="bank">
    <Notice text={t('localNotice')} />
    {!active && <Card style={{ alignItems: 'center', paddingVertical: 34 }}>
      <View style={{ padding: 20, borderRadius: 22, backgroundColor: colors.pale }}><FileSpreadsheet size={36} color={colors.green} /></View>
      <Text style={styles.title}>{t('importTitle')}</Text><Text style={[styles.muted, { textAlign: 'center' }]}>{t('importHint')}</Text>
    </Card>}
    <Card>
      <View style={styles.between}><Text style={styles.h2}>{t('import')}</Text><Badge>{t('importWorkspace')}: {t(workspace)}</Badge></View>
      <Text style={styles.muted}>{t('chooseBank')}</Text>
      <View style={styles.row}><Button label="Chase" selected={bank === 'chase'} onPress={() => setBank('chase')} /><Button label="Old National Bank" selected={bank === 'south-national'} onPress={() => setBank('south-national')} /></View>
      {bank === 'south-national' && <Notice text={locale === 'ru' ? 'Для Old National Bank используется общий формат CSV с указанными ниже колонками. Отдельный формат выписки этого банка пока не проверен; сверьте даты и суммы с оригиналом.' : 'Old National Bank uses the generic CSV format with the columns listed below. A bank-specific statement layout has not yet been verified; check dates and amounts against the original.'} />}
      <Text style={styles.muted}>{t('alias')}</Text><TextInput accessibilityLabel={t('alias')} value={alias} onChangeText={setAlias} placeholder={t('aliasHint')} placeholderTextColor={colors.muted} maxLength={60} style={styles.input} />
      <Text style={styles.muted}>{t('formatHint')}</Text>
      <View style={styles.row}><Button primary label={t('upload')} disabled={busy} onPress={() => void load(false)} icon={<FileUp size={17} color="white" />} /><Button label={t('sampleFile')} disabled={busy} onPress={() => void load(true)} /></View>
      {busy && <View style={styles.row}><ActivityIndicator color={colors.green} /><Text style={styles.muted}>{t('loading')}</Text></View>}
      {error && <Notice error text={t(error)} />}
      <Text style={[styles.muted, { fontSize: 11 }]}>{t('columnsHint')}</Text>
    </Card>
    {active && <Card>
      <View style={styles.between}><View style={{ gap: 6 }}><Text style={styles.h2}>{t('preview')}</Text><Text style={styles.muted}>{active.name} · {active.preview.accountAlias}</Text></View><Button label={t('discard')} onPress={() => { savePreview(workspace); setError(null); }} /></View>
      {active.sample && <Badge>{t('sample')}</Badge>}
      <Notice text={t('notVerified')} />
      <Text style={styles.muted}>{active.preview.from || '—'} → {active.preview.to || '—'}</Text>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        {[[t('rows'), active.preview.rows.length], [t('credits'), formatMoney(active.preview.creditsCents, locale)], [t('debits'), formatMoney(active.preview.debitsCents, locale)], [t('reviewCount'), issues]].map(([label, value]) => <View key={label} style={{ gap: 6, paddingVertical: 8 }}><Text style={styles.muted}>{label}</Text><Text style={styles.h2}>{value}</Text></View>)}
      </View>
      <SearchField value={search} onChange={value => { setSearch(value); setPage(0); }} placeholder={t('search')} />
      <View style={styles.row}><Button label={t('allTypes')} selected={!onlyIssues} onPress={() => { setOnlyIssues(false); setPage(0); }} /><Button label={t('review')} selected={onlyIssues} onPress={() => { setOnlyIssues(true); setPage(0); }} /></View>
      <ScrollView horizontal><View style={{ minWidth: 650 }}>
        <View style={{ flexDirection: 'row', padding: 12, backgroundColor: colors.bg }}><Text style={[styles.label, { width: 110 }]}>{t('date')}</Text><Text style={[styles.label, { width: 250 }]}>{t('description')}</Text><Text style={[styles.label, { width: 130 }]}>{t('amount')}</Text><Text style={styles.label}>{t('status')}</Text></View>
        {visibleRows.slice(currentPage * 50, (currentPage + 1) * 50).map(row => <View key={row.line} style={{ flexDirection: 'row', padding: 12, borderBottomColor: colors.line, borderBottomWidth: 1 }}><Text style={[styles.text, { width: 110 }]}>{row.date}</Text><Text style={[styles.text, { width: 250, paddingRight: 15 }]}>{row.description}</Text><Text style={[styles.text, { width: 130, color: row.amountCents > 0 ? colors.green : colors.ink }]}>{formatMoney(row.amountCents, locale)}</Text><View style={{ maxWidth: 250 }}><Text style={[styles.muted, { color: row.issues.length ? colors.amber : colors.muted }]}>{row.issues.length ? row.issues.map(code => t(code)).join(' · ') : t('parsed')}</Text></View></View>)}
      </View></ScrollView>
      {pageCount > 1 && <View style={styles.between}><Button label={t('previous')} disabled={currentPage === 0} onPress={() => setPage(currentPage - 1)} /><Text style={styles.muted}>{t('page')} {currentPage + 1} / {pageCount}</Text><Button label={t('next')} disabled={currentPage === pageCount - 1} onPress={() => setPage(currentPage + 1)} /></View>}
      {!visibleRows.length && <Text style={styles.muted}>{t('noResults')}</Text>}
      {active.preview.errors.map(item => <Notice key={item.line} error text={`${t('line')} ${item.line}: ${t(item.code)}`} />)}
      <View style={styles.row}><ShieldCheck size={17} color={colors.green} /><Text style={styles.muted}>{t('noPosting')}</Text></View>
      <Text selectable style={[styles.muted, { fontSize: 10 }]}>{t('fileHash')}: {active.hash}</Text>
    </Card>}
  </Shell>;
}
