import React,{useState} from 'react';
import {ActivityIndicator,ScrollView,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {router} from 'expo-router';
import {apiURL} from '../auth/client';
import {Button,Card,Notice,styles,colors} from '../components/ui';
import {useApp} from '../state';

export default function Activate() {
  const {t,locale,setLocale}=useApp();
  const [token,setToken]=useState(''),[password,setPassword]=useState(''),[repeat,setRepeat]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[email,setEmail]=useState('');
  const ready=!!apiURL && /^[0-9a-f]{64}$/.test(token.trim()) && password.length>=12
    && password.length<=128 && password===repeat && !busy;
  async function activate() {
    if(!ready)return;
    setBusy(true);setError('');
    try {
      const result=await fetch(`${apiURL}/v1/invitations/accept`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({token:token.trim(),password}),
      });
      if(!result.ok){setError(t(result.status===400?'inviteInvalid':'authUnavailable'));return;}
      const data=await result.json();setEmail(data.email);setToken('');
    } catch {setError(t('authUnavailable'));}
    finally {setPassword('');setRepeat('');setBusy(false);}
  }
  return <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:24,gap:20,maxWidth:650,width:'100%',alignSelf:'center'}}>
      <View style={styles.between}><Text style={styles.title}>nestwise</Text><Button label={locale==='ru'?'EN':'RU'} onPress={()=>setLocale(locale==='ru'?'en':'ru')}/></View>
      <Card><Text accessibilityRole="header" style={styles.title}>{t('inviteTitle')}</Text>
        {email ? <Notice text={`${t('inviteSuccess')} ${email}`}/> : <>
          <Text style={styles.muted}>{t('inviteHint')}</Text>
          {!apiURL&&<Notice text={t('authNotConfigured')}/>}
          {!!error&&<Notice error text={error}/>}
          <Text style={styles.text}>{t('inviteCode')}</Text>
          <TextInput accessibilityLabel={t('inviteCode')} style={styles.input} value={token} onChangeText={setToken}
            autoCapitalize="none" autoCorrect={false} autoComplete="off" secureTextEntry editable={!busy} maxLength={64}/>
          <Text style={styles.text}>{t('invitePassword')}</Text>
          <TextInput accessibilityLabel={t('invitePassword')} style={styles.input} value={password} onChangeText={setPassword}
            secureTextEntry autoComplete="new-password" editable={!busy} maxLength={128}/>
          <Text style={styles.text}>{t('inviteRepeat')}</Text>
          <TextInput accessibilityLabel={t('inviteRepeat')} style={styles.input} value={repeat} onChangeText={setRepeat}
            secureTextEntry autoComplete="new-password" editable={!busy} maxLength={128}/>
          {!!repeat&&repeat!==password&&<Notice error text={t('inviteMismatch')}/>}
          {busy&&<ActivityIndicator accessibilityLabel={t('authLoading')} color={colors.green}/>}
          <Button label={t('inviteSubmit')} primary disabled={!ready} onPress={()=>void activate()}/>
        </>}
      </Card>
      <Button label={t('authSignIn')} onPress={()=>router.replace('/account')}/>
    </ScrollView>
  </SafeAreaView>;
}
