import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { apiURL, authClient, authenticatedFetch } from '../auth/client';
import { Button, Card, Notice, styles, colors } from '../components/ui';
import { useApp } from '../state';
import {AccountJournal} from '../components/AccountJournal';
import {AccountEvents} from '../components/AccountEvents';
import {AccountInsights} from '../components/AccountInsights';
type Access={user:{name:string;email:string};workspaces:{id:string;name:string;role:string;accounts:{id:string;name:string;currency:string}[]}[]};
export default function Account() {
  const {t,locale,setLocale}=useApp();
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(!!apiURL),[error,setError]=useState('');
  const [selected,setSelected]=useState<{workspace:string;account:string;name:string;currency:string}|null>(null);
  const [expired,setExpired]=useState(false);
  const [section,setSection]=useState<'insights'|'journal'|'events'>('insights');
  const sessionExpired=useCallback(()=>{setAccess(null);setSelected(null);setExpired(true);},[]);
  useEffect(()=>{
    const controller=new AbortController();
    let active=true;
    if(apiURL) authenticatedFetch('/v1/session',controller.signal).then(async response=>{
      if(response.status===401) return null;
      if(!response.ok) throw new Error();
      return await response.json() as Access;
    }).then(value=>{if(active)setAccess(value);})
      .catch(()=>{if(!controller.signal.aborted)setError(t('authUnavailable'));})
      .finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;controller.abort();};
    // Locale changes should not restart a session request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  async function signIn() {
    setBusy(true);setError('');setExpired(false);setSelected(null);
    try {
      const result=await authClient.signIn.email({email:email.trim(),password});
      setPassword('');
      if(result.error) {setError(result.error.status===429?t('authRateLimit'):t('authInvalid'));return;}
      const response=await authenticatedFetch('/v1/session');
      if(!response.ok) throw new Error();
      setAccess(await response.json());
    } catch {setError(t('authUnavailable'));} finally {setBusy(false);}
  }
  async function signOut() {
    setBusy(true);setError('');
    try {
      const result=await authClient.signOut();
      if(result.error) throw new Error();
      setAccess(null);setSelected(null);setPassword('');
    } catch {setError(t('authLogoutFailed'));} finally {setBusy(false);}
  }
  return <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,gap:20,maxWidth:650,width:'100%',alignSelf:'center'}}>
      <View style={styles.between}><Text style={styles.title}>nestwise</Text><Button label={locale==='ru'?'EN':'RU'} onPress={()=>setLocale(locale==='ru'?'en':'ru')}/></View>
      <Card><Text accessibilityRole="header" style={styles.title}>{access?t('authAccount'):t('authSignIn')}</Text>
        <Text style={styles.muted}>{t('authHint')}</Text>
        {!apiURL&&<Notice text={t('authNotConfigured')}/>}
        {!!error&&<Notice error text={error}/>}
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
      {access&&<Card><Text style={styles.h2}>{t('authSpaces')}</Text>
        {access.workspaces.length===0&&<Notice text={t('authNoAccess')}/>}
        {access.workspaces.map(space=><View key={space.id} style={{gap:10}}>
          <Text style={styles.h2}>{space.name}</Text>
          {space.accounts.length===0&&<Notice text={t('journalNoAccounts')}/>}
          {space.accounts.map(account=><Button key={account.id} label={`${account.name} · ${account.currency}`} selected={selected?.workspace===space.id&&selected.account===account.id} disabled={busy} onPress={()=>setSelected({workspace:space.id,account:account.id,name:account.name,currency:account.currency})}/>)}
        </View>)}
      </Card>}
      {access&&selected&&<>
        <View style={styles.row}>
          <Button label={t('insightsTitle')} selected={section==='insights'} onPress={()=>setSection('insights')}/>
          <Button label={t('journalTitle')} selected={section==='journal'} onPress={()=>setSection('journal')}/>
          <Button label={t('eventsTitle')} selected={section==='events'} onPress={()=>setSection('events')}/>
        </View>
        {section==='insights'?<AccountInsights key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
          workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired} onEvents={()=>setSection('events')}/>:
          section==='journal'?<AccountJournal key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
          workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>:
          <AccountEvents key={`${selected.workspace}:${selected.account}`} name={selected.name} currency={selected.currency}
            workspace={selected.workspace} account={selected.account} onSessionExpired={sessionExpired}/>}
      </>}
      <Button label={t('authDemoBack')} onPress={()=>router.replace('/')}/>
    </ScrollView>
  </SafeAreaView>;
}
