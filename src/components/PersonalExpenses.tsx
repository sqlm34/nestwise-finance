import React,{useEffect,useState} from 'react';
import {Text,View} from 'react-native';
import {authenticatedFetch} from '../auth/client';
import {useApp} from '../state';
import {personalCategories,receiptCategoryTotals} from '../domain/personal-documents';
import type {ReceiptData} from '../domain/receipt';
import {exactUsd} from '../domain/exact-money';
import {Button,Card,Notice,styles} from './ui';
type Expense={hash:string;paid_on:string;bank_id:string|null;item_categories:string[];extra_category:string;data:ReceiptData};
export function PersonalExpenses({workspace,account,onSessionExpired,onReceipts}:{workspace:string;account:string;onSessionExpired:()=>void;onReceipts:()=>void}){
 const {locale}=useApp(),ru=locale==='ru';const [rows,setRows]=useState<Expense[]>([]),[error,setError]=useState(false),[category,setCategory]=useState('all'),[expanded,setExpanded]=useState('');
 useEffect(()=>{let active=true;const controller=new AbortController();void authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/personal-expenses`,controller.signal).then(async r=>{if(r.status===401){onSessionExpired();return;}if(!r.ok)throw Error();const v=await r.json();if(!Array.isArray(v))throw Error();v.forEach(e=>receiptCategoryTotals(e.data,e.item_categories,e.extra_category));if(active)setRows(v);}).catch(()=>{if(active)setError(true);});return()=>{active=false;controller.abort();};},[workspace,account,onSessionExpired]);
 const label=(id:string)=>personalCategories.find(c=>c.id===id)?.[ru?'ru':'en']||id;
 const totals=new Map<string,bigint>();rows.forEach(e=>receiptCategoryTotals(e.data,e.item_categories,e.extra_category).forEach(t=>totals.set(t.category,(totals.get(t.category)||0n)+BigInt(t.cents))));
 const money=(s:string|bigint)=>exactUsd(BigInt(s),locale);
 return <Card><Text style={styles.h2}>{ru?'Мои расходы по чекам':'My receipt expenses'}</Text>
  <Button primary label={ru?'Сканировать / загрузить чек':'Scan / upload receipt'} onPress={onReceipts}/>
  <Notice text={ru?'Здесь сохранённые покупки с категориями позиций. Покупка, связанная с банком, учитывается один раз. Показаны последние 500 чеков по этому счёту.':'Saved purchases with item categories. A bank-linked purchase is counted once. Showing up to 500 recent receipts for this account.'}/>
  {error&&<Notice error text={ru?'Не удалось загрузить расходы.':'Could not load expenses.'}/>}
  <Button label={ru?'Все категории':'All categories'} selected={category==='all'} onPress={()=>setCategory('all')}/>
  {[...totals].map(([id,total])=><Button key={id} label={`${label(id)} · ${money(total)}`} selected={category===id} onPress={()=>setCategory(id)}/>)}
  {rows.filter(e=>category==='all'||e.item_categories.includes(category)||e.extra_category===category).map(e=><View key={e.hash} style={{gap:6,paddingVertical:9}}>
   <Button label={`${e.paid_on.slice(0,10)} · ${e.data.supplier} · ${money(e.data.total_cents!)} · ${e.bank_id?(ru?'Связано с банком':'Bank linked'):(ru?'Наличные':'Cash')}`} onPress={()=>setExpanded(v=>v===e.hash?'':e.hash)}/>
   {expanded===e.hash&&<>{e.data.items.map((item,i)=><Text key={i} style={styles.text}>{item.description} · {money(item.cents!)} · {label(e.item_categories[i])}</Text>)}<Text style={styles.muted}>{ru?'Налог, доставка, чаевые и скидка':'Tax, shipping, tip and discount'}: {label(e.extra_category)}</Text></>}
  </View>)}
  {!error&&!rows.length&&<Text style={styles.muted}>{ru?'Сохраните первый чек и назначьте категории.':'Save your first receipt and assign categories.'}</Text>}
 </Card>;
}
