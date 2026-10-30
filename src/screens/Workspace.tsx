import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, Text, TextInput, View } from 'react-native';
import {BackStepsContext} from '../back-navigation';
import {createBackSteps} from '../domain/back-steps';
import {LiveShell} from '../components/LiveShell';
import { router, useFocusEffect } from 'expo-router';
import { apiURL, authClient, authenticatedFetch } from '../auth/client';
import { Button, NavigationItem, Card, Notice, styles, colors } from '../components/ui';
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
import {resolveSelection, parseAccess, workingAccess, selectionKey, type Access, type Selection} from '../domain/live-navigation';
import {defaultJournalFilters} from '../domain/journal-filters';
import categories from '../data/accountant-categories.json';
export type LiveSection='insights'|'journal'|'refunds'|'expenses'|'events'|'reconciliation'|'savedReconciliation'|'operations'|'receipts'|'mapping'|'settings'|'reports';
const routes:Record<LiveSection,string>={insights:'/',journal:'/transactions',refunds:'/refunds',expenses:'/expenses',events:'/crm',reconciliation:'/bank',savedReconciliation:'/reconcile',operations:'/operations',receipts:'/receipts',mapping:'/mapping',settings:'/settings',reports:'/reports'};
export default function Workspace({initialSection='insights'}:{initialSection?:LiveSection}) {
  const {t,locale,offline}=useApp();
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(!!apiURL),[error,setError]=useState('');
  const [selected,setSelected]=useState<Selection|null>(null);
  const [expired,setExpired]=useState(false);
  const [administration,setAdministration]=useState<string|null|undefined>(undefined);
  const section=initialSection;
  const sectionTitle={insights:t('insightsTitle'),journal:locale==='ru'?'Операции':'Transactions',refunds:locale==='ru'?'Возвраты и корректировки':'Refunds & Adjustments',expenses:locale==='ru'?'Расходы бизнеса':'Business Expenses',events:t('crm'),reconciliation:t('bank'),savedReconciliation:t('reconcile'),operations:locale==='ru'?'Новая операция':'New operation',receipts:locale==='ru'?'Чеки':'Receipts',mapping:locale==='ru'?'Налоговые категории':'Tax Categories',settings:locale==='ru'?'Язык и настройки':'Language & Settings',reports:locale==='ru'?'Налоговый центр / PDF':'Tax Center / PDF'}[section];
  const setSection=(next:LiveSection)=>{if(next!==section)router.push(routes[next] as '/');};
  const [selectionError,setSelectionError]=useState(false);
  const [chooseAccount,setChooseAccount]=useState(false);
  const [backSteps]=useState(createBackSteps);
  useFocusEffect(useCallback(()=>{
    const subscription=BackHandler.addEventListener('hardwareBackPress',()=>{
      if(administration!==undefined){setAdministration(undefined);return true;}
      if(chooseAccount){setChooseAccount(false);return true;}
      if(backSteps.back())return true;
      if(router.canGoBack()){router.back();return true;}
      if(section!=='insights'){router.replace('/');return true;}
      return busy||!!access;
    });
    return ()=>subscription.remove();
  },[backSteps,administration,chooseAccount,section,access,busy]));
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
        const value=workingAccess(parseAccess(await response.json()));
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
  const navigation=(close:()=>void)=>access&&selected?(        <View style={{gap:0}}>
          <NavigationItem label={t('overview')} selected={section==='insights'} onPress={() => {setSection('insights');close();}}/>
          <NavigationItem label={locale==='ru'?'Операции':'Transactions'} selected={section==='journal'} onPress={() => {setSection('journal');close();}}/>
          <NavigationItem label={t('crm')} selected={section==='events'} onPress={() => {setSection('events');close();}}/>
          <NavigationItem label={locale==='ru'?'Возвраты и корректировки':'Refunds & Adjustments'} selected={section==='refunds'} onPress={()=>{setSection('refunds');close();}}/>
          <NavigationItem label={locale==='ru'?'Расходы бизнеса':'Business Expenses'} selected={section==='expenses'} onPress={()=>{setSection('expenses');close();}}/>
          <NavigationItem label={t('bank')} selected={section==='reconciliation'} onPress={() => {setSection('reconciliation');close();}}/>
          <NavigationItem label={t('reconcile')} selected={section==='savedReconciliation'} onPress={()=>{setSection('savedReconciliation');close();}}/>
          <NavigationItem label={locale==='ru'?'Налоговые категории':'Tax Categories'} selected={section==='mapping'} onPress={() => {setSection('mapping');close();}}/>
          {access.workspaces.find(space=>space.id===selected.workspace)?.kind==='business'&&<NavigationItem label={locale==='ru'?'Налоговый центр / PDF':'Tax Center / PDF'} selected={section==='reports'} onPress={() => {setSection('reports');close();}}/>}
          <NavigationItem label={locale==='ru'?'Язык и настройки':'Language & Settings'} selected={section==='settings'} onPress={() => {setSection('settings');close();}}/>
        </View>):null;
  return <BackStepsContext.Provider value={backSteps}><LiveShell access={access} selected={selected} title={access?(section==='insights'?t('overview'):sectionTitle):t('authSignIn')} navigation={navigation} onSelect={selectAccount} onSignOut={()=>void signOut()} onAccounts={()=>setChooseAccount(value=>!value)} busy={busy}>


      {(!access||busy||!!error||offline||selectionError||expired)&&<Card>
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
      </Card>}
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
        {section==='expenses'&&<View style={styles.row}><Button label={locale==='ru'?'Чеки и распознавание':'Receipts and scanning'} onPress={()=>setSection('receipts')}/>{['owner','accountant'].includes(access.workspaces.find(w=>w.id===selected.workspace)?.role||'')&&<Button primary label={locale==='ru'?'+ Добавить операцию':'+ Add operation'} onPress={()=>setSection('operations')}/>}</View>}


        {['insights','settings','journal'].includes(section)&&<OperationRecovery key={`${access.user.id}:${selected.workspace}:${selected.account}`} user={access.user.id} workspace={selected.workspace} account={selected.account} onOpen={()=>setSection('operations')}/>}
        {section==='reports'?(access.workspaces.find(space=>space.id===selected.workspace)?.kind==='business'?<AccountReports personalAccounts={access.workspaces.filter(w=>['personal','family'].includes(w.kind||'')&&['owner','accountant'].includes(w.role)).flatMap(w=>w.accounts.map(a=>({workspace:w.id,account:a.id,name:w.name+' · '+a.name})))} key={`${selected.workspace}:${selected.account}`} workspace={selected.workspace} account={selected.account} canWrite={['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')} onSessionExpired={sessionExpired}/>:<Notice text={locale==='ru'?'Форма только для бизнеса Aksenov LLC.':'This form is for the Aksenov LLC business only.'}/>):section==='mapping'?<Card><Text accessibilityRole="header" style={styles.h2}>{t('mapping')}</Text><Notice text={t('mappingHint')}/><Notice text={locale==='ru'?'Категории используются для Statement. Они не определяют налоговые вычеты; согласование в приложении не требуется.':'Categories organize the Statement. They do not determine tax deductions; no in-app approval is required.'}/><ScrollView horizontal><View style={{minWidth:640}}><View style={{flexDirection:'row',padding:10,backgroundColor:'#f8faf9'}}><Text style={[styles.label,{width:220}]}>ID</Text><Text style={[styles.label,{width:400}]}>{locale==='ru'?'КАТЕГОРИЯ':'CATEGORY'}</Text></View>{categories.categories.map(row=><View key={row.id} style={{flexDirection:'row',paddingHorizontal:10,paddingVertical:13,borderBottomWidth:1,borderColor:'#edf1ef'}}><Text style={[styles.muted,{width:220,fontSize:12}]}>{row.id}</Text><View style={{width:400}}><Text style={[styles.text,{fontSize:12}]}>{row[locale]}</Text>{locale==='ru'&&<Text style={[styles.muted,{fontSize:11}]}>{row.en}</Text>}</View></View>)}</View></ScrollView></Card>:
          section==='settings'?<Card><Text style={styles.h2}>{t('settings')}</Text><View style={styles.row}><Button label={locale==='ru'?'Аккаунт и пространства':'Account and spaces'} onPress={()=>setChooseAccount(value=>!value)}/><Button label={locale==='ru'?'Чеки':'Receipts'} onPress={()=>setSection('receipts')}/></View><Text style={styles.muted}>{locale==='ru'?'Данные относятся к выбранному рабочему пространству и счёту.':'Data belongs to the selected workspace and account.'}</Text><Button label={locale==='ru'?'Обновить доступ':'Refresh access'} onPress={refreshAccess}/></Card>:
          section==='receipts'?<AccountReceipts business={access.workspaces.find(space=>space.id===selected.workspace)?.kind==='business'} key={`${selected.workspace}:${selected.account}`} workspace={selected.workspace} account={selected.account} canWrite={['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')} onSessionExpired={sessionExpired}/>:
          section==='operations'&&!['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')?<Notice error text={t('journalAccessLost')}/>:section==='operations'?<ManualOperationForm user={access.user.id} key={`${access.user.id}:${selected.workspace}:${selected.account}`} workspace={selected.workspace} account={selected.account} accounts={access.workspaces.find(space=>space.id===selected.workspace)?.accounts||[]} onSaved={()=>setSection('journal')} onSessionExpired={sessionExpired}/>:
          ['reconciliation','savedReconciliation'].includes(section)?<AccountReconciliation savedOnly={section==='savedReconciliation'} canWrite={['owner','accountant'].includes(access.workspaces.find(space=>space.id===selected.workspace)?.role||'')} key={`${selected.workspace}:${selected.account}`} name={selected.name} workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>:
          section==='insights'?<AccountInsights allowAppUpdate={administration===undefined&&!chooseAccount} key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
          workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired} onEvents={()=>setSection('events')} onReports={()=>setSection('reports')} onBank={()=>setSection('reconciliation')} onReceipts={()=>setSection('receipts')}/>:
          ['journal','refunds','expenses'].includes(section)?<AccountJournal initialFilters={{...defaultJournalFilters,code:section==='refunds'?'refunds':section==='expenses'?'expenses':'all'}} key={`${selected.workspace}:${selected.account}:${section}`} name={selected.name} currency={selected.currency}
          workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>:
          <AccountEvents key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
            workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>}
      </>}

    </LiveShell></BackStepsContext.Provider>;
}
