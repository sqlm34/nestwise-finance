import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { apiURL, authClient, authenticatedFetch } from '../auth/client';
import { Button, Card, Notice, styles, colors } from '../components/ui';
import { useApp } from '../state';
import {AccountJournal} from '../components/AccountJournal';
import {AccountEvents} from '../components/AccountEvents';
import {AccountInsights} from '../components/AccountInsights';
import {AccountReconciliation} from '../components/AccountReconciliation';
import {OperationRecovery} from '../components/OperationRecovery';
import {ManualOperationForm} from '../components/ManualOperationForm';
import {WorkspaceAdministration} from '../components/WorkspaceAdministration';
import {AccountReports} from '../components/AccountReports';
import {AccountReceipts} from '../components/AccountReceipts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {resolveSelection, parseAccess, selectionKey, type Access, type Selection} from '../domain/live-navigation';
import categories from '../data/accountant-categories.json';
export type LiveSection='insights'|'journal'|'events'|'reconciliation'|'operations'|'receipts'|'mapping'|'settings'|'reports';
const routes:Record<LiveSection,string>={insights:'/',journal:'/transactions',events:'/crm',reconciliation:'/bank',operations:'/operations',receipts:'/receipts',mapping:'/mapping',settings:'/settings',reports:'/reports'};
export default function Workspace({initialSection='insights'}:{initialSection?:LiveSection}) {
  const {t,locale,setLocale,offline}=useApp();
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(!!apiURL),[error,setError]=useState('');
  const [selected,setSelected]=useState<Selection|null>(null);
  const [expired,setExpired]=useState(false);
  const [administration,setAdministration]=useState<string|null|undefined>(undefined);
  const section=initialSection;
  const sectionTitle={insights:t('insightsTitle'),journal:t('journalTitle'),events:t('crm'),reconciliation:t('reconciliationTitle'),operations:locale==='ru'?'Новая операция':'New operation',receipts:locale==='ru'?'Чеки':'Receipts',mapping:t('mapping'),settings:t('settings'),reports:'Financial Statement'}[section];
  const setSection=(next:LiveSection)=>router.replace(routes[next] as '/');
  const [selectionError,setSelectionError]=useState(false);
  const [chooseAccount,setChooseAccount]=useState(false);
  const requestAbort=useRef<AbortController|null>(null);
  const requestVersion=useRef(0);
  const accessRef=useRef<Access|null>(null);
  const installAccess=useCallback((value:Access|null)=>{accessRef.current=value;setAccess(value);},[]);
  const sessionExpired=useCallback(()=>{requestVersion.current++;installAccess(null);setSelected(null);setExpired(true);setBusy(false);},[installAccess]);
  const selectAccount=(value:Selection)=>{
    setSelected(value);setAdministration(undefined);setChooseAccount(false);setSelectionError(false);
    const current=accessRef.current;if(!current)return;
    void AsyncStorage.setItem(selectionKey(current.user.id),JSON.stringify({workspace:value.workspace,account:value.account})).catch(()=>setSelectionError(true));
  };
  const refreshAccess=useCallback(()=>{
    const version=++requestVersion.current;
    requestAbort.current?.abort();const controller=new AbortController();requestAbort.current=controller;
    setAdministration(undefined);setSelected(null);installAccess(null);setBusy(!!apiURL);setError('');
    if(!apiURL)return;
    void (async()=>{
      try{
        const response=await authenticatedFetch('/v1/session',controller.signal);
        if(version!==requestVersion.current)return;
        if(response.status===401){setBusy(false);return;}
        if(!response.ok)throw new Error();
        const value=parseAccess(await response.json());
        let stored:null|string=null;
        try{stored=await AsyncStorage.getItem(selectionKey(value.user.id));}catch{if(version===requestVersion.current)setSelectionError(true);}
        if(version!==requestVersion.current)return;
        installAccess(value);setSelected(resolveSelection(value,stored));setExpired(false);
      }catch{if(version===requestVersion.current)setError('authUnavailable');}
      finally{if(version===requestVersion.current)setBusy(false);}
    })();
  },[installAccess]);
  useFocusEffect(useCallback(()=>{refreshAccess();return()=>{requestVersion.current++;requestAbort.current?.abort();installAccess(null);setSelected(null);setPassword('');};},[refreshAccess,installAccess]));
  async function signIn() {
    const version=++requestVersion.current;
    setBusy(true);setError('');setExpired(false);setSelected(null);
    try {
      const result=await authClient.signIn.email({email:email.trim(),password});
      if(version!==requestVersion.current)return;
      setPassword('');
      if(result.error){setError(result.error.status===429?t('authRateLimit'):t('authInvalid'));return;}
      refreshAccess();
    } catch {if(version===requestVersion.current)setError(t('authUnavailable'));}
    finally {if(version===requestVersion.current)setBusy(false);}
  }
  async function signOut() {
    const version=++requestVersion.current,current=accessRef.current;
    setBusy(true);setError('');setSelected(null);
    try {
      const result=await authClient.signOut();
      if(version!==requestVersion.current)return;
      if(result.error)throw new Error();
      installAccess(null);setPassword('');
      if(current)try{await AsyncStorage.removeItem(selectionKey(current.user.id));}catch{setSelectionError(true);}
    } catch {if(version===requestVersion.current)setError(t('authLogoutFailed'));}
    finally {if(version===requestVersion.current)setBusy(false);}
  }
  return <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,gap:20,maxWidth:1100,width:'100%',alignSelf:'center'}}>
      <View style={styles.between}><Text style={styles.title}>nestwise</Text><Button label={locale==='ru'?'EN':'RU'} onPress={()=>setLocale(locale==='ru'?'en':'ru')}/></View>
      <Card><Text accessibilityRole="header" style={styles.title}>{access?sectionTitle:t('authSignIn')}</Text>
        {!access&&<Text style={styles.muted}>{t('authHint')}</Text>}
        {!apiURL&&<Notice text={t('authNotConfigured')}/>}
        {!!error&&<Notice error text={error==='authUnavailable'?t('authUnavailable'):error}/>}
        {offline&&<Notice text={t('offline')}/>}
        {!!error&&<Button label={locale==='ru'?'Повторить подключение':'Retry connection'} disabled={busy} onPress={refreshAccess}/>}
        {selectionError&&<Notice error text={t('settingsError')}/>}
        {expired&&<Notice error text={t('authExpired')}/>}
        {busy&&<ActivityIndicator accessibilityLabel={t('authLoading')} color={colors.green}/>}
        {access ? <>
          <Text style={styles.h2}>{access.user.name}</Text><Text style={styles.muted}>{access.user.email}</Text>
          <Button label={t('authSignOut')} disabled={busy} onPress={()=>void signOut()}/>
        </> : <>
          <Text style={styles.text}>{t('authEmail')}</Text>
          <TextInput accessibilityLabel={t('authEmail')} style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" editable={!busy}/>
          <Text style={styles.text}>{t('authPassword')}</Text>
          <TextInput accessibilityLabel={t('authPassword')} style={styles.input} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" editable={!busy} onSubmitEditing={()=>{if(apiURL&&email&&password&&!busy)void signIn();}}/>
          <Button label={t('authSignIn')} primary disabled={busy||!apiURL||!email||!password} onPress={()=>void signIn()}/>
          <Button label={t('inviteTitle')} disabled={busy} onPress={()=>router.push('/activate')}/>
        </>}
      </Card>
      {access&&(!selected||chooseAccount)&&<Card><Text style={styles.h2}>{t('authSpaces')}</Text>
        <Button label={locale==='ru'?'Новое пространство':'New workspace'} onPress={()=>setAdministration(null)}/>
        {access.workspaces.length===0&&<Notice text={t('authNoAccess')}/>}
        {access.workspaces.map(space=><View key={space.id} style={{gap:10}}>
          <Text style={styles.h2}>{space.name}</Text>
          {space.role==='owner'&&<Button label={locale==='ru'?'Настроить пространство':'Manage workspace'} onPress={()=>setAdministration(space.id)}/>}
          {space.accounts.length===0&&<Notice text={t('journalNoAccounts')}/>}
          {space.accounts.map(account=><Button key={account.id} label={`${account.name} · ${account.currency}`} selected={selected?.workspace===space.id&&selected.account===account.id} disabled={busy} onPress={()=>selectAccount({workspace:space.id,account:account.id,name:account.name,currency:account.currency})}/>)}
        </View>)}
      </Card>}
      {access&&administration!==undefined&&<WorkspaceAdministration key={administration||'new'} workspace={administration} onChanged={refreshAccess} onSessionExpired={sessionExpired}/>}
      {access&&selected&&!busy&&<>
        <Card><Button label={locale==='ru'?'Сменить счёт / управление':'Change account / manage'} onPress={()=>setChooseAccount(value=>!value)}/><Text accessibilityRole="header" style={styles.h2}>{selected.name} · {selected.currency}</Text><Text style={styles.muted}>{locale==='ru'?'Рабочие данные выбранного счёта. Смена счёта закрывает текущую форму.':'Live data for the selected account. Changing accounts closes the current form.'}</Text></Card>
        <View style={styles.row}>
          <Button label={t('insightsTitle')} selected={section==='insights'} onPress={()=>setSection('insights')}/>
          <Button label={t('journalTitle')} selected={section==='journal'} onPress={()=>setSection('journal')}/>
          <Button label={t('crm')} selected={section==='events'} onPress={()=>setSection('events')}/>
          <Button label={t('bank')+' / '+t('reconcile')} selected={section==='reconciliation'} onPress={()=>setSection('reconciliation')}/>
          {access.workspaces.find(space=>space.id===selected.workspace)?.kind==='business'&&<Button label="Financial Statement" selected={section==='reports'} onPress={()=>setSection('reports')}/>}
          <Button label={t('mapping')} selected={section==='mapping'} onPress={()=>setSection('mapping')}/>
          <Button label={t('settings')} selected={section==='settings'} onPress={()=>setSection('settings')}/>
          <Button label={locale==='ru'?'Чеки':'Receipts'} selected={section==='receipts'} onPress={()=>setSection('receipts')}/>
          {['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')&&<Button label={locale==='ru'?'Новая операция':'New operation'} selected={section==='operations'} onPress={()=>setSection('operations')}/>}
        </View>
        {['insights','settings','journal'].includes(section)&&<OperationRecovery key={`${access.user.id}:${selected.workspace}:${selected.account}`} user={access.user.id} workspace={selected.workspace} account={selected.account} onOpen={()=>setSection('operations')}/>}
        {section==='reports'?(access.workspaces.find(space=>space.id===selected.workspace)?.kind==='business'?<AccountReports personalAccounts={access.workspaces.filter(w=>['personal','family'].includes(w.kind||'')&&['owner','accountant'].includes(w.role)).flatMap(w=>w.accounts.map(a=>({workspace:w.id,account:a.id,name:w.name+' · '+a.name})))} key={`${selected.workspace}:${selected.account}`} workspace={selected.workspace} account={selected.account} canWrite={['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')} onSessionExpired={sessionExpired}/>:<Notice text={locale==='ru'?'Форма только для бизнеса Aksenov LLC.':'This form is for the Aksenov LLC business only.'}/>):section==='mapping'?<Card><Text accessibilityRole="header" style={styles.h2}>{t('mapping')}</Text><Notice text={t('mappingHint')}/><Notice text={locale==='ru'?'Категории используются для Statement. Они не определяют налоговые вычеты; согласование в приложении не требуется.':'Categories organize the Statement. They do not determine tax deductions; no in-app approval is required.'}/>{categories.categories.map(row=><View key={row.id} style={{gap:4,paddingVertical:8}}><Text style={styles.text}>{row[locale]}</Text><Text style={styles.muted}>{row.id} · {row.en}</Text></View>)}</Card>:
          section==='settings'?<Card><Text style={styles.h2}>{t('settings')}</Text><Text style={styles.muted}>{t('privacyHint')}</Text><Button label={locale==='ru'?'Обновить доступ':'Refresh access'} onPress={refreshAccess}/></Card>:
          section==='receipts'?<AccountReceipts business={access.workspaces.find(space=>space.id===selected.workspace)?.kind==='business'} key={`${selected.workspace}:${selected.account}`} workspace={selected.workspace} account={selected.account} canWrite={['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')} onSessionExpired={sessionExpired}/>:
          section==='operations'&&!['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')?<Notice error text={t('journalAccessLost')}/>:section==='operations'?<ManualOperationForm user={access.user.id} key={`${access.user.id}:${selected.workspace}:${selected.account}`} workspace={selected.workspace} account={selected.account} accounts={access.workspaces.find(space=>space.id===selected.workspace)?.accounts||[]} onSaved={()=>setSection('journal')} onSessionExpired={sessionExpired}/>:
          section==='reconciliation'?<AccountReconciliation canWrite={['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')} key={`${selected.workspace}:${selected.account}`} name={selected.name} workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>:
          section==='insights'?<AccountInsights key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
          workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired} onEvents={()=>setSection('events')}/>:
          section==='journal'?<AccountJournal key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
          workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>:
          <AccountEvents key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
            workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>}
      </>}
      <Button label={t('authDemoBack')} onPress={()=>router.push('/demo')}/>
    </ScrollView>
  </SafeAreaView>;
}
