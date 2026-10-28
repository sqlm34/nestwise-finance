import {CrmConnectionStatus} from './CrmConnectionStatus';
import React,{useState} from 'react';
import {Modal,Pressable,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Menu,X} from 'lucide-react-native';
import {useApp} from '../state';
import {Button,NavigationItem,colors,styles,Badge} from './ui';
import type {Access,Selection} from '../domain/live-navigation';

export function LiveShell({children,access,selected,title,navigation,onSelect,onSignOut,busy}:{
 children:React.ReactNode;access:Access|null;selected:Selection|null;title:string;
 navigation:(close:()=>void)=>React.ReactNode;onSelect:(value:Selection)=>void;onSignOut:()=>void;onAccounts:()=>void;busy:boolean;
}){
 const {locale,setLocale,t}=useApp();const {width}=useWindowDimensions();
 const [menu,setMenu]=useState(false);const [accounts,setAccounts]=useState(false);const wide=width>720;
 const space=access?.workspaces.find(w=>w.id===selected?.workspace);
 const sidebar=<View style={{paddingHorizontal:13,paddingVertical:25,gap:0,flex:1,backgroundColor:'#fff'}}>
  <View style={{flexDirection:'row',alignItems:'center',gap:9,marginHorizontal:10,marginBottom:32}}><View style={{width:36,height:36,borderRadius:11,backgroundColor:colors.green,alignItems:'center',justifyContent:'center'}}><Text style={{color:'#fff',fontSize:25,fontWeight:'800'}}>n</Text></View><Text style={{color:colors.ink,fontSize:25,fontWeight:'800',letterSpacing:-1.4}}>nestwise</Text>{!wide&&<Pressable accessibilityRole="button" accessibilityLabel={t('close')} onPress={()=>setMenu(false)} style={{marginLeft:'auto',padding:10}}><X size={20} color={colors.ink}/></Pressable>}</View>
  <Text style={[styles.label,{marginHorizontal:10,marginBottom:8,color:'#9aaca4'}]}>{locale==='ru'?'ПРОСТРАНСТВА':'SPACES'}</Text>
  {access?.workspaces.map(w=><NavigationItem key={w.id} label={w.name} disabled={busy} selected={selected?.workspace===w.id}
   onPress={()=>{const a=w.accounts.find(a=>a.id===selected?.account)||w.accounts[0];if(a)onSelect({workspace:w.id,account:a.id,name:a.name,currency:a.currency});setMenu(false);}}/>)}
  {selected&&<View style={{gap:0,marginTop:14}}><Text style={[styles.label,{paddingHorizontal:12,marginBottom:8}]}>{locale==='ru'?'РАБОЧЕЕ ПРОСТРАНСТВО':'WORKSPACE'}</Text>{navigation(()=>setMenu(false))}</View>}
  {access&&<Button label={t('authSignOut')} disabled={busy} onPress={onSignOut}/>}
 </View>;
 return <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}>
  <View style={{flex:1,flexDirection:'row'}}>
   {access&&wide&&<View style={{width:248,borderRightWidth:1,borderColor:colors.line}}><ScrollView>{sidebar}</ScrollView></View>}
   <View style={{flex:1}}>
    <View style={{minHeight:wide?72:62,flexDirection:'row',alignItems:'center',gap:12,backgroundColor:'#fff',paddingHorizontal:wide?30:15,borderBottomWidth:1,borderColor:colors.line}}>
     <View style={{flexDirection:'row',alignItems:'center',gap:12,flex:1}}>
      {access&&!wide&&<Pressable accessibilityRole="button" accessibilityLabel={t('menu')} onPress={()=>setMenu(true)} style={{padding:10}}><Menu size={23} color={colors.ink}/></Pressable>}
      <Text numberOfLines={1} style={[styles.muted,{flex:1}]}>{space?`${space.name} / ${title}`:'nestwise'}</Text>
     </View>
     {access&&selected&&wide&&<Badge>{locale==='ru'?'Рабочий аккаунт':'Live account'}</Badge>}
     {access&&selected&&wide&&<Button label={`${selected.name} ▾`} onPress={()=>setAccounts(true)}/>}
     <Button label={locale==='ru'?'Русский ▾':'English ▾'} onPress={()=>setLocale(locale==='ru'?'en':'ru')}/>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal:wide?32:14,paddingTop:wide?27:20,gap:17,maxWidth:1330,width:'100%',alignSelf:'center',paddingBottom:75}}>
     <View style={{gap:3}}><Text style={styles.muted}>{locale==='ru'?'Финансовое пространство':'Financial workspace'}</Text>
      <Text accessibilityRole="header" style={[styles.title,{fontSize:wide?30:24,letterSpacing:-1.1,marginBottom:4}]}>{title}</Text>
      <Text style={styles.muted}>{locale==='ru'?'Единая финансовая система':'Finance that stays in sync'}</Text>
     </View>
     {access&&selected&&!wide&&<View style={{alignItems:'flex-start'}}><Button label={`${selected.name} ▾`} onPress={()=>setAccounts(true)}/></View>}
     {children}
     {selected&&space?.kind==='business'&&<CrmConnectionStatus key={`${selected.workspace}:${selected.account}`} workspace={selected.workspace} account={selected.account}/>}
    </ScrollView>
   </View>
  </View>
  <Modal visible={accounts} transparent animationType="fade" onRequestClose={()=>setAccounts(false)}>
   <View style={{flex:1,backgroundColor:'rgba(25,55,47,0.2)',justifyContent:'center',padding:20}}><View style={{backgroundColor:'#fff',padding:21,borderRadius:17,gap:8,maxWidth:420,width:'100%',alignSelf:'center'}}>
    <Text style={styles.h2}>{space?.name}</Text>{space?.accounts.map(a=><NavigationItem key={a.id} label={`${a.name} · ${a.currency}`} selected={a.id===selected?.account} onPress={()=>{if(space)onSelect({workspace:space.id,account:a.id,name:a.name,currency:a.currency});setAccounts(false);}}/>)}
    <Button label={t('close')} onPress={()=>setAccounts(false)}/>
   </View></View>
  </Modal>
  <Modal visible={!!access&&!wide&&menu} animationType="slide" onRequestClose={()=>setMenu(false)}>
   <SafeAreaView style={{flex:1}}><ScrollView>{sidebar}</ScrollView></SafeAreaView>
  </Modal>
 </SafeAreaView>;
}
