import React,{useEffect,useRef,useState} from 'react';
import {Modal,ScrollView,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import {personalCategories} from '../domain/personal-documents';
import {classifyReceipt,businessReceiptCategories,isBusinessCategory,type ReceiptClassification,type ReceiptCategory} from '../domain/receipt-classification';
import type {ReceiptData} from '../domain/receipt';
import {exactUsd} from '../domain/exact-money';
import {DigitalReceipt} from './DigitalReceipt';
import {ReceiptBankMatch} from './ReceiptBankMatch';
import {Button,Notice,styles} from './ui';
type Target={workspace:string;account:string;name:string};
type State={classification:ReceiptClassification|null;payment:{paid_on:string;item_categories:string[]}|null;targets:Target[]};
export function PersonalReceiptDetails({workspace,account,hash,review,data,canWrite,ru,onSessionExpired,onEdit}:{workspace:string;account:string;hash:string;review:string;data:ReceiptData;canWrite:boolean;ru:boolean;onSessionExpired:()=>void;onEdit:()=>void}){
 const path=`/v1/user/workspaces/${workspace}/accounts/${account}/receipts/${hash}/classification`;
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[choosing,setChoosing]=useState<number|null>(null),[query,setQuery]=useState(''),[scope,setScope]=useState<'personal'|'business'>('business'),[target,setTarget]=useState<Target|null>(null);
 const [retry,setRetry]=useState<Record<string,unknown>|null>(null),[reload,setReload]=useState(0);
 const alive=useRef(true),lock=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{let active=true;void authenticatedFetch(path).then(async r=>{if(r.status===401){onSessionExpired();return;}if(!r.ok)throw Error();const value:State=await r.json();if(!Array.isArray(value.targets))throw Error();if(active){setState(value);setError('');setTarget(value.targets.find(t=>t.account===value.classification?.business_account)||(value.targets.length===1?value.targets[0]:null));}}).catch(()=>{if(active)setError(ru?'Не удалось загрузить категории. Повторите загрузку.':'Could not load categories. Retry loading.');});return()=>{active=false;};},[path,ru,onSessionExpired,reload]);
 const current=state?.classification?.review_id===review?state.classification:null;
 const categories:ReceiptCategory[]=current?.categories??state?.payment?.item_categories??data.items.map(()=>null);
 let split:ReturnType<typeof classifyReceipt>|null=null;try{split=classifyReceipt(data,categories);}catch{/* Incomplete OCR stays visible and editable. */}
 const money=(n:string)=>exactUsd(BigInt(n),ru?'ru':'en');
 async function save(body:Record<string,unknown>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');setRetry(body);
  try{const r=await authenticatedPost(path,body);if(r.status===401){onSessionExpired();return;}const value=await r.json();if(!r.ok)throw Error(value.error);if(alive.current){setState(s=>s?{...s,classification:value}:s);setRetry(null);setChoosing(null);setNotice(ru?'Категория сохранена.':'Category saved.');}}
  catch(e){if(alive.current){const code=e instanceof Error?e.message:'';setError(code==='receipt_classification_conflict'?(ru?'Чек изменён на другом устройстве. Обновите данные перед выбором категории.':'Receipt changed on another device. Reload before choosing a category.'):code==='receipt_business_already_linked'?(ru?'Эта покупка уже вручную связана с бизнесом в Statement. Сначала исправьте прежнюю связь, чтобы не учитывать её дважды.':'This purchase already has a manual business link in Statement. Resolve that link before item classification to avoid duplicate costs.'):(ru?'Сохранение не подтверждено. Повторите тот же запрос.':'Save was not confirmed. Retry the same request.'));}}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 function choose(category:ReceiptCategory){if(choosing===null||!state||!split)return;const next=categories.map((c,i)=>i===choosing?category:c);const business=next.some(isBusinessCategory);if(business&&!target)return;
  void save({id:randomUUID(),expected:state.classification?.revision??0,review,categories:next,business_workspace:business?target!.workspace:null,business_account:business?target!.account:null});
 }
 const options=(scope==='business'?businessReceiptCategories:personalCategories).filter(c=>`${c.en} ${c.ru}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <View style={{gap:14}}>
  <DigitalReceipt data={data} categories={categories} ru={ru} disabled={!canWrite||busy||!state||!split||!!retry} onCategory={canWrite?index=>{setChoosing(index);setQuery('');setScope(isBusinessCategory(categories[index])?'business':categories[index]?'personal':'business');}:undefined}/>
  {!!notice&&<Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text>}
  {!!error&&<><Notice error text={error}/>{retry&&<Button label={ru?'Повторить сохранение':'Retry save'} disabled={busy} onPress={()=>void save(retry)}/>}<Button label={ru?'Загрузить сохранённые данные':'Reload saved details'} disabled={busy} onPress={()=>{setRetry(null);setChoosing(null);setReload(n=>n+1);}}/></>}
  {busy&&<Text accessibilityLiveRegion="polite" style={styles.muted}>{ru?'Сохраняем категорию…':'Saving category…'}</Text>}
  {!split&&<Notice text={ru?'Для назначения категорий проверьте дату, позиции и итог. Неизвестные суммы показаны знаком «—».':'Check the date, items and total before assigning categories. Unknown amounts are shown as —.'}/>}
  {canWrite&&!state?.payment&&<Button label={ru?'Исправить распознанные данные':'Edit recognized details'} disabled={busy||!!retry} onPress={onEdit}/>}
  {split&&<><Text style={styles.text}>{ru?'Личное':'Personal'}: {money(split.personal_cents)} · Aksenov LLC: {money(split.business_cents)}</Text><Text style={styles.muted}>{ru?'Налог, общие сборы и скидка распределяются между позициями пропорционально их стоимости, точно до цента. Названия и цены позиций сохранены как в чеке.':'Tax, shared charges and discount are allocated proportionally by item price to the cent. Item names and prices remain as printed.'}</Text></>}
  {state&&split&&<ReceiptBankMatch workspace={workspace} account={account} hash={hash} review={review} data={data} disabled={busy||!!retry} canWrite={canWrite} hasPayment={!!state.payment} ru={ru} onSessionExpired={onSessionExpired} onSaved={()=>setReload(n=>n+1)}/>}
  <Modal visible={choosing!==null} transparent animationType="fade" onRequestClose={()=>{if(!busy)setChoosing(null);}}>
   <View style={{flex:1,backgroundColor:'#0007',justifyContent:'center',alignItems:'center',padding:18}}>
    <View accessibilityViewIsModal style={{width:'100%',maxWidth:520,maxHeight:'85%',backgroundColor:'white',borderRadius:18,padding:18,gap:10}}>
     <Text accessibilityRole="header" style={styles.h2}>{ru?'Категория позиции':'Item category'}</Text><Text numberOfLines={2} style={styles.muted}>{choosing===null?'':data.items[choosing]?.description}</Text>
     <View style={styles.row}><Button label={ru?'Личное':'Personal'} selected={scope==='personal'} disabled={busy} onPress={()=>setScope('personal')}/><Button label="Aksenov LLC · Statement" selected={scope==='business'} disabled={busy} onPress={()=>setScope('business')}/></View>
     {scope==='business'&&!target&&<><Notice text={ru?'Выберите бизнес-счёт для этих расходов.':'Choose the business account for these costs.'}/>{state?.targets.map(t=><Button key={t.account} label={t.name} disabled={busy} onPress={()=>setTarget(t)}/>)}</>}
     <TextInput autoFocus accessibilityLabel={ru?'Найти категорию':'Find category'} placeholder={ru?'Например, инструменты / tools':'For example, tools'} style={styles.input} value={query} onChangeText={setQuery} editable={!busy}/>
     <ScrollView keyboardShouldPersistTaps="handled" style={{flexShrink:1}} contentContainerStyle={{gap:6}}>{options.map(c=><Button key={c.id} label={`${c[ru?'ru':'en']}${ru?` · ${c.en}`:''}`} selected={choosing!==null&&categories[choosing]===c.id} disabled={busy||!!retry||scope==='business'&&!target} onPress={()=>choose(c.id)}/>)}{!options.length&&<Text style={styles.muted}>{ru?'Нет совпадений':'No matches'}</Text>}</ScrollView>
     {!!error&&<Notice error text={error}/>}<Button label={ru?'Убрать категорию':'Clear category'} disabled={busy||!!retry} onPress={()=>choose(null)}/><Button label={ru?'Закрыть':'Close'} disabled={busy} onPress={()=>setChoosing(null)}/>
    </View>
   </View>
  </Modal>
 </View>;
}
