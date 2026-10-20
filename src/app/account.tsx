import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { apiURL, authClient, authenticatedFetch } from '../auth/client';
import { Button, Card, Notice, styles, colors } from '../components/ui';
import { useApp } from '../state';
type Access={user:{name:string;email:string};workspaces:{id:string;name:string;role:string;accounts:{id:string;name:string;currency:string}[]}[]};
export default function Account() {
  const {t,locale,setLocale}=useApp();
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');
  const [access,setAccess]=useState<Access|null>(null),[busy,setBusy]=useState(!!apiURL),[error,setError]=useState('');
  const [journal,setJournal]=useState<{name:string;count:number}|null>(null);
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
    setBusy(true);setError('');setJournal(null);
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
      setAccess(null);setJournal(null);setPassword('');
    } catch {setError(t('authLogoutFailed'));} finally {setBusy(false);}
  }
  async function readJournal(workspace:string,account:string,name:string) {
    setBusy(true);setError('');setJournal(null);
    try {
      const result=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/journal`);
      if(result.status===401) {setAccess(null);setError(t('authExpired'));return;}
      if(!result.ok) throw new Error();
      const data=await result.json();setJournal({name,count:data.entries.length});
    } catch {setError(t('authUnavailable'));} finally {setBusy(false);}
  }
  return <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,gap:20,maxWidth:650,width:'100%',alignSelf:'center'}}>
      <View style={styles.between}><Text style={styles.title}>nestwise</Text><Button label={locale==='ru'?'EN':'RU'} onPress={()=>setLocale(locale==='ru'?'en':'ru')}/></View>
      <Card><Text accessibilityRole="header" style={styles.title}>{access?t('authAccount'):t('authSignIn')}</Text>
        <Text style={styles.muted}>{t('authHint')}</Text>
        {!apiURL&&<Notice text={t('authNotConfigured')}/>}
        {!!error&&<Notice error text={error}/>}
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
          {space.accounts.map(account=><Button key={account.id} label={`${account.name} · ${account.currency}`} disabled={busy} onPress={()=>void readJournal(space.id,account.id,account.name)}/>)}
        </View>)}
        {journal&&<Notice text={`${journal.name}: ${t('authEntries')} ${journal.count}`}/>}
      </Card>}
      <Button label={t('authDemoBack')} onPress={()=>router.replace('/')}/>
    </ScrollView>
  </SafeAreaView>;
}
