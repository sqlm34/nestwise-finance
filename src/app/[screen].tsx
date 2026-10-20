import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import Bank from '../screens/Bank';
import { CrmScreen, MappingScreen, ReconciliationScreen, SettingsScreen, TransactionsScreen } from '../screens/Sections';
import { Shell } from '../components/Shell';
import { useApp } from '../state';
const sections = { bank: Bank, crm: CrmScreen, mapping: MappingScreen, reconcile: ReconciliationScreen, settings: SettingsScreen, transactions: TransactionsScreen };
export default function Section() {
  const { screen } = useLocalSearchParams<{ screen: string }>();
  const { t, workspace } = useApp();
  const Component = sections[screen as keyof typeof sections];
  return Component ? <Component key={workspace} /> : <Shell title="unknownPage"><Text>{t('unknownPage')}</Text></Shell>;
}
