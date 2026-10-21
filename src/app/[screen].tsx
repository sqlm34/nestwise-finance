import {useLocalSearchParams} from 'expo-router';
import {Text} from 'react-native';
import Workspace,{type LiveSection} from '../screens/Workspace';
import {Shell} from '../components/Shell';
import {useApp} from '../state';
const sections:Record<string,LiveSection>={overview:'insights',transactions:'journal',bank:'reconciliation',reconcile:'reconciliation',crm:'events',receipts:'receipts',operations:'operations',mapping:'mapping',settings:'settings'};
export default function Section(){
  const {screen}=useLocalSearchParams<{screen:string}>();
  const {t}=useApp();
  const section=sections[screen];
  return section?<Workspace key={section} initialSection={section}/>:<Shell title="unknownPage"><Text>{t('unknownPage')}</Text></Shell>;
}
