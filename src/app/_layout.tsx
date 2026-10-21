import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Provider } from '../state';
export default function Layout() {
  return <SafeAreaProvider><Provider><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false, animation: 'none' }} /></Provider></SafeAreaProvider>;
}
