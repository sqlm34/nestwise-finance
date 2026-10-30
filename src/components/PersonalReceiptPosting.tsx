import React,{useEffect,useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import {parseReceipt,type ReceiptData} from '../domain/receipt';
import {personalCategories,receiptCategoryTotals,documentDate} from '../domain/personal-documents';
import {exactUsd} from '../domain/exact-money';
import {Button,Notice,styles} from './ui';
type BankRow={id:string;paid_on:string;name:string;cents:string;pending:boolean};
export function PersonalReceiptPosting({workspace,account,hash,review,data,disabled,ru,onSessionExpired,onSaved}:{workspace:string;account:string;hash:string;review:string;data:ReceiptData;disabled:boolean;ru:boolean;onSessionExpired:()=>void;onSaved:()=>void}){
 const [categories,setCategories]=useState(data.items.map(()=> 'groceries')),[extra,setExtra]=useState('groceries');
 const [choosing,setChoosing]=useState<number|null>(null),[paid,setPaid]=useState(data.date),[bank,setBank]=useState<BankRow[]>([]);
 const [selected,setSelected]=useState<string|null|undefined>(undefined),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
 const [confirmation,setConfirmation]=useState(false);const command=useRef(randomUUID()),sending=useRef(false),alive=useRef(true);
 const path=`/v1/user/workspaces/${workspace}/accounts/${account}`;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const label=(id:string)=>personalCategories.find(c=>c.id===id)?.[ru?'ru':'en']||id;
 const money=(s:string|null)=>s===null?'—':exactUsd(BigInt(s),ru?'ru':'en');
 let totals:{category:string;cents:string}[]=[];let valid=false;
 try{totals=receiptCategoryTotals(data,categories,extra);parseReceipt(data,true);valid=!!documentDate(paid);}catch{/* Review must be complete before recording. */}
 async function find(){setError('');setBusy(true);setLoaded(false);setSelected(undefined);setConfirmation(false);
  try{if(!documentDate(paid))throw Error();const date=Date.parse(paid+'T12:00:00Z'),from=new Date(date-7*86400000).toISOString().slice(0,10),to=new Date(date+7*86400000).toISOString().slice(0,10);
   const r=await authenticatedFetch(`${path}/bank-feed?from=${from}&to=${to}`);if(r.status===401){onSessionExpired();return;}if(!r.ok)throw Error();
   const v=await r.json();if(!Array.isArray(v.rows))throw Error();if(alive.current){setBank(v.rows.filter((row:BankRow)=>BigInt(row.cents)===-BigInt(data.total_cents!)));setLoaded(true);}
  }catch{if(alive.current)setError(ru?'Не удалось проверить банк. Проверьте дату и повторите.':'Could not check the bank. Check the date and retry.');}finally{if(alive.current)setBusy(false);}
 }
 async function save(){if(sending.current||selected===undefined)return;sending.current=true;setBusy(true);setError('');
  try{const r=await authenticatedPost(`${path}/personal-expenses/${hash}`,{id:command.current,review,paid_on:paid,bank_id:selected,categories,extra});if(r.status===401){onSessionExpired();return;}if(!r.ok)throw Error();if(alive.current){setSaved(true);onSaved();}}
  catch{if(alive.current)setError(ru?'Не удалось подтвердить сохранение. Если банковская операция изменилась или уже связана с чеком, обновите список. Повтор этого запроса не создаст второй расход.':'Could not confirm saving. The bank transaction may have changed or already be linked. Retrying this request will not create another expense.');}
  finally{sending.current=false;if(alive.current)setBusy(false);}
 }
 if(saved)return <Notice text={ru?'Расход сохранён с категориями позиций.':'Expense saved with item categories.'}/>;
 return <View style={{gap:10}}>
  <Text style={styles.h2}>{ru?'Категории и оплата':'Categories and payment'}</Text>
  <Button label={`${ru?'Весь чек':'Whole receipt'}: ${label(extra)}`} disabled={disabled||busy||confirmation} onPress={()=>setChoosing(-1)}/>
  {data.items.map((item,i)=><View key={i} style={{gap:4,paddingVertical:6}}><Text style={styles.text}>{i+1}. {item.description} · {money(item.cents)}</Text><Button label={label(categories[i])} disabled={disabled||busy||confirmation} onPress={()=>setChoosing(i)}/></View>)}
  <Button label={`${ru?'Налог, чаевые, доставка и скидка':'Tax, tip, shipping and discount'}: ${label(extra)}`} disabled={disabled||busy||confirmation} onPress={()=>setChoosing(-2)}/>
  {choosing!==null&&<View style={{gap:6}}>{personalCategories.map(c=><Button key={c.id} label={c[ru?'ru':'en']} onPress={()=>{if(choosing===-1){setCategories(data.items.map(()=>c.id));setExtra(c.id);}else if(choosing===-2)setExtra(c.id);else setCategories(v=>v.map((value,i)=>i===choosing?c.id:value));setChoosing(null);}}/>)}<Button label={ru?'Закрыть категории':'Close categories'} onPress={()=>setChoosing(null)}/></View>}
  {totals.map(t=><Text key={t.category} style={styles.text}>{label(t.category)}: {money(t.cents)}</Text>)}
  <TextInput accessibilityLabel={ru?'Дата оплаты':'Payment date'} placeholder="YYYY-MM-DD" style={styles.input} value={paid} editable={!disabled&&!busy&&!confirmation} onChangeText={v=>{setPaid(v);setLoaded(false);setSelected(undefined);}}/>
  <Button label={ru?'Найти списание в этом банке':'Find withdrawal in this bank'} disabled={disabled||busy||!valid||confirmation} onPress={()=>void find()}/>
  {loaded&&<>
   <Notice text={ru?'Показаны совпадения суммы в пределах 7 дней. Проверьте продавца и дату. Связанный чек не создаёт второе списание.':'Matching amounts within 7 days. Check the merchant and date. Linking a receipt does not create another withdrawal.'}/>
   {bank.map(row=><Button key={row.id} label={`${row.paid_on} · ${row.name} · ${money(row.cents)}${row.pending?(ru?' · Ожидает подтверждения банком':' · Pending'):''}`} selected={selected===row.id} disabled={row.pending||busy||confirmation} onPress={()=>setSelected(row.id)}/>)}
   {!bank.length&&<Text style={styles.muted}>{ru?'Совпадений пока нет. Если платили картой, сохранённый чек можно сопоставить позже, когда банк передаст списание.':'No matches yet. For card payments, match this saved receipt later when the bank provides the withdrawal.'}</Text>}
   <Button label={ru?'Оплачено наличными — отдельный расход':'Paid in cash — separate expense'} selected={selected===null} disabled={busy||confirmation} onPress={()=>setSelected(null)}/>
  </>}
  {!valid&&<Notice text={ru?'Сначала заполните все суммы и сохраните проверенную версию чека.':'First complete the amounts and save the reviewed receipt.'}/>}
  {confirmation?<><Notice text={selected===null?(ru?'Сохранить оплату наличными и категории? Не выбирайте наличные, если платили картой.':'Save this cash payment and categories? Do not choose cash for a card payment.'):(ru?'Связать чек с выбранным списанием и сохранить категории позиций?':'Link the receipt to this withdrawal and save item categories?')}/><Button primary label={ru?'Подтвердить':'Confirm'} disabled={busy} onPress={()=>void save()}/><Button label={ru?'Назад':'Back'} disabled={busy} onPress={()=>setConfirmation(false)}/></>:<Button primary label={ru?'Сохранить расход':'Save expense'} disabled={disabled||busy||!valid||selected===undefined} onPress={()=>setConfirmation(true)}/>}
  {!!error&&<Notice error text={error}/>}
 </View>;
}
