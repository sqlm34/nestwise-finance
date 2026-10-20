import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { router, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeftRight, Building2, ChevronRight, CircleHelp, FileText, House, LayoutDashboard, Leaf, Link2, Menu, Settings2, ShieldCheck, Tags, UserRound, Users, X } from 'lucide-react-native';
import { useApp } from '../state';
import { workspaceIds } from '../data/demo';
import { colors, styles, Badge, Notice } from './ui';
import type { MessageKey } from '../i18n';

export const pages = ['overview', 'transactions', 'bank', 'reconcile', 'crm', 'mapping', 'settings'] as const;
export type Page = typeof pages[number];
const icons = { overview: LayoutDashboard, transactions: ArrowLeftRight, bank: FileText, reconcile: ShieldCheck, crm: Link2, mapping: Tags, settings: Settings2 };
const spaceIcons = { family: Users, alex: UserRound, irina: UserRound, business: Building2 };
export function navigate(page: Page) { router.push(page === 'overview' ? '/' : `/${page}`); }

export function Shell({ children, title, actions }: { children: React.ReactNode; title: MessageKey; actions?: React.ReactNode }) {
  const { t, workspace, setWorkspace, locale, setLocale, offline } = useApp();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const pathname = usePathname();
  const current = pathname === '/' ? 'overview' : pathname.slice(1);
  const [menu, setMenu] = useState(false);
  const sidebar = <View style={{ flex: 1, backgroundColor: '#fff', padding: 22, gap: 24 }}>
    <View style={[styles.row, { paddingVertical: 10 }]}>
      <View style={{ backgroundColor: colors.green, borderRadius: 12, padding: 9 }}><Leaf size={23} color="white" /></View>
      <Text style={{ fontSize: 27, fontWeight: '700', letterSpacing: -1.1, color: colors.ink }}>nestwise</Text>
      {!wide && <Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={() => setMenu(false)} style={{ padding: 12, marginLeft: 'auto' }}><X size={22} color={colors.ink} /></Pressable>}
    </View>
    <View style={{ gap: 5 }}><Text style={[styles.label, { padding: 10 }]}>{t('spaces')}</Text>
      {workspaceIds.map(id => { const Icon = spaceIcons[id]; return <Pressable key={id} accessibilityRole="button" accessibilityLabel={t(id)} accessibilityState={{ selected: workspace === id }}
        onPress={() => { setWorkspace(id); setMenu(false); }}
        style={{ minHeight: 45, flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: workspace === id ? colors.pale : 'transparent' }}>
        <Icon size={18} color={workspace === id ? colors.green : colors.muted} /><Text style={{ flex: 1, color: workspace === id ? colors.green : colors.muted, fontSize: 13, fontWeight: workspace === id ? '600' : '400' }}>{t(id)}</Text>
        {workspace === id && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green }} />}
      </Pressable>; })}
    </View>
    <View style={{ gap: 5 }}><Text style={[styles.label, { padding: 10 }]}>{t('workspace')}</Text>
      {pages.map(page => { const Icon = icons[page]; return <Pressable accessibilityRole="button" accessibilityLabel={t(page)} accessibilityState={{ selected: current === page }} key={page}
        onPress={() => { navigate(page); setMenu(false); }}
        style={{ minHeight: 45, flexDirection: 'row', gap: 12, alignItems: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: current === page ? '#f0f5f1' : 'transparent' }}>
        <Icon size={18} color={current === page ? colors.green : colors.muted} /><Text style={{ fontSize: 13, flex: 1, color: current === page ? colors.ink : colors.muted, fontWeight: current === page ? '600' : '400' }}>{t(page)}</Text>
      </Pressable>; })}
    </View>
    <View style={{ marginTop: 'auto', borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 20, gap: 8 }}>
      <View style={styles.row}><CircleHelp size={16} color={colors.muted} /><Text style={styles.muted}>{t('stage')}</Text></View>
      <Text style={[styles.muted, { fontSize: 11 }]}>{t('stageHint')}</Text>
    </View>
  </View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
    <View style={{ flex: 1, flexDirection: 'row' }}>
      {wide && <View style={{ width: 258, borderRightWidth: 1, borderRightColor: colors.line }}><ScrollView contentContainerStyle={{ flexGrow: 1 }}>{sidebar}</ScrollView></View>}
      <View style={{ flex: 1 }}>
        <View style={{ minHeight: 74, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: wide ? 34 : 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <View style={[styles.row, { flex: 1 }]}>
            {!wide && <Pressable accessibilityRole="button" accessibilityLabel={t('menu')} onPress={() => setMenu(true)} style={{ padding: 10 }}><Menu size={23} color={colors.ink} /></Pressable>}
            {wide && <House size={15} color={colors.muted} />}<Text style={styles.muted}>{t(workspace)}</Text>{wide && <><ChevronRight size={13} color={colors.muted} /><Text style={styles.text}>{t(title)}</Text></>}
          </View>
          <View style={styles.row}>{width > 650 && <Badge>{t('demo')}</Badge>}
            <Pressable accessibilityRole="button" accessibilityLabel={locale === 'ru' ? 'English' : 'Русский'} onPress={() => setLocale(locale === 'ru' ? 'en' : 'ru')} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 8 }}><Text style={styles.text}>{locale === 'ru' ? 'EN' : 'RU'}</Text></Pressable>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: wide ? 34 : 18, paddingBottom: 40, gap: 22, width: '100%', maxWidth: 1450, alignSelf: 'center' }}>
          {offline && <Notice text={t('offline')} />}
          <View style={styles.between}><View style={{ gap: 7, flex: 1, minWidth: 240 }}><Text style={styles.label}>{t(workspace)}</Text><Text accessibilityRole="header" style={styles.title}>{t(title)}</Text><Text style={styles.muted}>{t('subtitle')}</Text></View>{actions}</View>
          <View style={[styles.row, { gap: 7 }]}><View style={{ width: 6, height: 6, backgroundColor: colors.amber, borderRadius: 3 }} /><Text style={[styles.muted, { fontSize: 12 }]}>{t('demoNotice')}</Text></View>
          {children}
          <Text style={[styles.muted, { fontSize: 11, marginTop: 10, textAlign: 'center' }]}>{t('footer')}</Text>
        </ScrollView>
      </View>
    </View>
    <Modal visible={!wide && menu} animationType="slide" onRequestClose={() => setMenu(false)}><SafeAreaView style={{ flex: 1 }}><ScrollView contentContainerStyle={{ flexGrow: 1 }}>{sidebar}</ScrollView></SafeAreaView></Modal>
  </SafeAreaView>;
}
