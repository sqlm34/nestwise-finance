import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { messages, type Locale, type MessageKey } from './i18n';
import type { Workspace } from './data/demo';
import type { StatementPreview } from './domain/statement';

export type PreviewFile = { name: string; hash: string; preview: StatementPreview; sample: boolean };
type State = {
  locale: Locale; setLocale: (value: Locale) => void;
  workspace: Workspace; setWorkspace: (value: Workspace) => void;
  previews: Partial<Record<Workspace, PreviewFile>>; savePreview: (space: Workspace, value?: PreviewFile) => void;
  t: (key: MessageKey) => string; preferenceError: boolean; offline: boolean;
};
const Context = createContext<State | null>(null);
export function Provider({ children }: { children: React.ReactNode }) {
  const [locale, updateLocale] = useState<Locale>('ru');
  const [preferenceError, setPreferenceError] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>('business');
  const [previews, setPreviews] = useState<State['previews']>({});
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('nestwise.locale').then(value => {
      if (active && (value === 'en' || value === 'ru')) updateLocale(value);
    }).catch(() => { if (active) setPreferenceError(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const setLocale = (value: Locale) => {
    updateLocale(value); setPreferenceError(false);
    AsyncStorage.setItem('nestwise.locale', value).catch(() => setPreferenceError(true));
  };
  return <Context.Provider value={{
    locale, setLocale, workspace, setWorkspace, previews, preferenceError, offline,
    savePreview: (space, value) => setPreviews(previous => ({ ...previous, [space]: value })),
    t: key => messages[locale][key],
  }}>{children}</Context.Provider>;
}
export function useApp() {
  const state = useContext(Context);
  if (!state) throw new Error('Missing app provider');
  return state;
}
