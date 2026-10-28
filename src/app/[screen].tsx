import {useLocalSearchParams,router} from 'expo-router';
import {Text,View} from 'react-native';
import Workspace,{type LiveSection} from '../screens/Workspace';
import {Button,styles} from '../components/ui';
import {useApp} from '../state';
const sections:Record<string,LiveSection>={overview:'insights',transactions:'journal',refunds:'refunds',expenses:'expenses',bank:'reconciliation',reconcile:'savedReconciliation',crm:'events',receipts:'receipts',operations:'operations',mapping:'mapping',settings:'settings',reports:'reports'};
export default function Section(){
 const {screen}=useLocalSearchParams<{screen:string}>();
 const {t}=useApp();const section=sections[screen];
 return section?<Workspace key={section} initialSection={section}/>:<View style={{padding:24,gap:16}}><Text style={styles.title}>{t('unknownPage')}</Text><Button label={t('overview')} onPress={()=>router.replace('/')}/></View>;
}
