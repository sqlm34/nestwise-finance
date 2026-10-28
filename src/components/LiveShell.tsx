import React,{useState} from 'react';
import {Modal,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Building2,Leaf,Menu,X} from 'lucide-react-native';
import {useApp} from '../state';
import {Button,colors,styles,Badge} from './ui';
import type {Access,Selection} from '../domain/live-navigation';

export function LiveShell({children,access,selected,title,navigation,onSelect,onSignOut,busy}:{
 children:React.ReactNode;access:Access|null;selected:Selection|null;title:string;
 navigation:React.ReactNode;onSelect:(value:Selection)=>void;onSignOut:()=>void;busy:boolean;
}){
 const {locale,setLocale,t}=useApp();const {width}=useWindowDimensions();
 const [menu,setMenu]=useState(false);const wide=width>=1000;
 const space=access?.workspaces.find(w=>w.id===selected?.workspace);
 const sidebar=<View style={{padding:22,gap:22,flex:1,backgroundColor:'#fff'}}>
  <View style={styles.row}><Leaf size={26} color={colors.green}/><Text style={styles.title}>nestwise</Text></View>
  {!wide&&<Button label={t('close')} icon={<X size={18}/>} onPress={()=>setMenu(false)}/>}
  <Text style={styles.label}>{locale==='ru'?'МОИ ПРОСТРАНСТВА':'MY WORKSPACES'}</Text>
  {access?.workspaces.map(w=><View key={w.id} style={{gap:8}}>
   <View style={styles.row}><Building2 size={17} color={colors.green}/><Text style={styles.h2}>{w.name}</Text></View>
   {w.accounts.map(a=><Button key={a.id} label={`${a.name} · ${a.currency}`} disabled={busy}
    selected={selected?.workspace===w.id&&selected?.account===a.id}
    onPress={()=>{onSelect({workspace:w.id,account:a.id,name:a.name,currency:a.currency});setMenu(false);}}/>)}
  </View>)}
  {selected&&<View style={{gap:8}}>{navigation}</View>}
 </View>;
 return <SafeAreaView style={{flex:1,backgroundColor:colors.bg}}>
  <View style={{flex:1,flexDirection:'row'}}>
   {access&&wide&&<View style={{width:270,borderRightWidth:1,borderColor:colors.line}}><ScrollView>{sidebar}</ScrollView></View>}
   <View style={{flex:1}}>
    <View style={[styles.between,{backgroundColor:'#fff',padding:18,borderBottomWidth:1,borderColor:colors.line}]}>
     <View style={[styles.row,{flex:1}]}>
      {access&&!wide&&<Button label={t('menu')} icon={<Menu size={20}/>} onPress={()=>setMenu(true)}/>}
      <View style={{flex:1,gap:3}}><Text style={styles.h2}>{space?.name||'nestwise'}</Text>
       <Text style={styles.muted}>{selected?`${selected.name} · ${selected.currency}`:t('authSpaces')}</Text></View>
     </View>
     <Button label={locale==='ru'?'EN':'RU'} onPress={()=>setLocale(locale==='ru'?'en':'ru')}/>
     {access&&<Button label={t('authSignOut')} disabled={busy} onPress={onSignOut}/>}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:wide?30:16,gap:20,maxWidth:1450,width:'100%',alignSelf:'center',paddingBottom:40}}>
     <View style={styles.between}><Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {access&&selected&&<Badge>{locale==='ru'?'Рабочий аккаунт':'Live account'}</Badge>}</View>
     {children}
    </ScrollView>
   </View>
  </View>
  <Modal visible={!!access&&!wide&&menu} animationType="slide" onRequestClose={()=>setMenu(false)}>
   <SafeAreaView style={{flex:1}}><ScrollView>{sidebar}</ScrollView></SafeAreaView>
  </Modal>
 </SafeAreaView>;
}
