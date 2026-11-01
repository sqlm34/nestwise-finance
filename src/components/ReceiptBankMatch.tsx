import React,{useEffect,useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {authenticatedFetch,authenticatedPost} from '../auth/client';
import {onForegroundRefresh} from '../foreground-refresh';
import type {ReceiptData} from '../domain/receipt';
import {PersonalReceiptPosting} from './PersonalReceiptPosting';
import {Button,Notice,styles} from './ui';
type Match={status:string;pdf_status:string;bank_account:string;bank_name:string;bank_mask:string;card_mask:string|null;paid_on:string|null};
type State={match:Match|null;targets:{account:string;name:string;mask:string}[];cards:{mask:string;account:string}[]};
const messages:Record<string,[string,string]>={
 waiting:['Ждём списание из банка. Чек сохранён и будет сопоставлен автоматически.','Waiting for the bank withdrawal. This saved receipt will be matched automatically.'],
 matched:['Сверено с банком. Расход учтён один раз; бизнес-позиции входят в Statement.','Verified against the bank. Expense counted once; business items enter Statement.'],
 ready:['Совпадение найдено. Нажмите «Сверить сейчас», чтобы связать чек.','Match found. Select Check now to link this receipt.'],
 needs_review:['Нужна проверка: продавец не совпал, операция ожидает подтверждения или найдено несколько одинаковых сумм. Автоматическая связь не создана.','Review needed: merchant differs, transaction is pending, or several amounts match. No automatic link was created.'],
 bank_changed:['Банковская операция изменилась. Расход исключён из актуального Statement до проверки.','Bank transaction changed. Excluded from the current Statement until reviewed.'],
 statement_mismatch:['PDF-выписка не подтверждает этот расход однозначно. Проверьте выписку и чек; в актуальный Statement расход не включён.','PDF statement does not confirm this expense uniquely. Review the statement and receipt; excluded from the current Statement.'],
 review_changed:['Данные чека изменились. Выберите банк заново для повторной сверки.','Receipt details changed. Select the bank again to recheck.'],
 already_linked:['Это списание или чек уже связаны с расходом. Повторный расход не создан.','This withdrawal or receipt is already linked. No duplicate expense was created.'],
 already_paid:['Оплата уже учтена. Повторный расход не создан.','Payment already recorded. No duplicate expense was created.'],
};
export function ReceiptBankMatch({workspace,account,hash,review,data,disabled,canWrite,hasPayment,ru,onSessionExpired,onSaved}:{workspace:string;account:string;hash:string;review:string;data:ReceiptData;disabled:boolean;canWrite:boolean;hasPayment:boolean;ru:boolean;onSessionExpired:()=>void;onSaved:()=>void}){
 const path=`/v1/user/workspaces/${workspace}/accounts/${account}/receipts/${hash}/payment`;
 const [state,setState]=useState<State|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[choose,setChoose]=useState(false),[cash,setCash]=useState(false),[mask,setMask]=useState(data.card_last4||'');
 const alive=useRef(true),lock=useRef(false),callbacks=useRef({onSessionExpired,onSaved,hasPayment});
 useEffect(()=>{callbacks.current={onSessionExpired,onSaved,hasPayment};},[onSessionExpired,onSaved,hasPayment]);
 useEffect(()=>{alive.current=true;let running=false,active=true;async function load(){if(running||lock.current)return;running=true;try{const r=await authenticatedFetch(path);if(r.status===401){callbacks.current.onSessionExpired();return;}if(!r.ok)throw Error();const value:State=await r.json();if(active){setState(value);setError('');if(value.match?.card_mask)setMask(value.match.card_mask);if(value.match?.paid_on&&!callbacks.current.hasPayment)callbacks.current.onSaved();}}catch{if(active)setError(ru?'Не удалось проверить связь с банком.':'Could not check the bank link.');}finally{running=false;}}
  void load();const stop=onForegroundRefresh(()=>void load(),60_000);return()=>{active=false;alive.current=false;stop();};},[path,ru]);
 async function save(bank:string,card:string|null){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
  const r=await authenticatedPost(path,{bank_account:bank,card_mask:card,review});if(r.status===401){callbacks.current.onSessionExpired();return;}if(!r.ok)throw Error();const value:State=await r.json();if(alive.current){setState(value);setChoose(false);callbacks.current.onSaved();}
 }catch{if(alive.current)setError(ru?'Не удалось сохранить сверку. Проверьте банк и последние четыре цифры карты. Повтор не создаст второй расход.':'Could not save matching. Check the bank and last four card digits. Retry will not create a duplicate expense.');}finally{lock.current=false;if(alive.current)setBusy(false);}}
 const m=state?.match,blocked=disabled||busy||!canWrite,validMask=mask===''||/^\d{4}$/.test(mask);
 return <View style={{gap:10}}>
  <Text style={styles.h2}>{ru?'Оплата и сверка':'Payment and verification'}</Text>
  {m?<><Text style={styles.text}>{m.bank_name} · {m.bank_mask}{m.card_mask?` · ${ru?'карта':'card'} •${m.card_mask}`:''}</Text>
   <Notice text={messages[m.status]?.[ru?0:1]??m.status}/>
   <Text style={styles.muted}>{m.pdf_status==='matched'?(ru?'PDF-выписка: совпадение подтверждено.':'PDF statement: match verified.'):m.pdf_status==='not_loaded'?(ru?'PDF-выписка за эту дату ещё не загружена. После загрузки она также будет проверена.':'No PDF statement for this date yet. It will also be checked after upload.'):(ru?'PDF-выписка: нужна проверка.':'PDF statement: review needed.')}</Text>
   {m.paid_on&&<Text style={styles.muted}>{ru?'Списание':'Withdrawal'}: {m.paid_on.slice(0,10)}</Text>}
   <Button label={ru?'Сверить сейчас':'Check now'} disabled={blocked} onPress={()=>void save(m.bank_account,m.card_mask)}/>
  </>:<Notice text={hasPayment?(ru?'Оплата уже учтена.':'Payment is already recorded.'):(ru?'Выберите карту или банк оплаты один раз. Сверим сумму, дату и продавца; если списание ещё не пришло, дождёмся его автоматически.':'Choose the payment card or bank once. We check amount, date and merchant, and wait automatically if the withdrawal has not arrived.')}/>}
  {!hasPayment&&<Button label={ru?'Указать карту или банк оплаты':'Choose payment card or bank'} disabled={blocked||!state} onPress={()=>{setChoose(v=>!v);setCash(false);}}/>}
  {choose&&state&&<>
   {state.cards.map(c=><Button key={c.mask} label={`${ru?'Карта':'Card'} •${c.mask} · ${state.targets.find(t=>t.account===c.account)?.name||''}`} disabled={blocked} onPress={()=>void save(c.account,c.mask)}/>)}
   <Text style={styles.muted}>{ru?'Последние 4 цифры карты (необязательно). Запомним банк для будущих чеков этой карты.':'Last 4 card digits (optional). Remember this bank for future receipts from this card.'}</Text>
   <TextInput accessibilityLabel={ru?'Последние четыре цифры карты':'Last four card digits'} style={styles.input} keyboardType="number-pad" maxLength={4} value={mask} editable={!blocked} onChangeText={setMask}/>
   {state.targets.map(t=><Button key={t.account} label={t.name} disabled={blocked||!validMask} onPress={()=>void save(t.account,mask||null)}/>)}
  </>}
  {!hasPayment&&!m&&!choose&&<Button label={ru?'Этот чек оплачен наличными':'This receipt was paid in cash'} disabled={blocked} onPress={()=>setCash(v=>!v)}/>}
  {cash&&!m&&!hasPayment&&<PersonalReceiptPosting workspace={workspace} account={account} hash={hash} review={review} data={data} disabled={disabled} ru={ru} hideCategories onSessionExpired={onSessionExpired} onSaved={onSaved}/>}
  {!!error&&<Notice error text={error}/>}
 </View>;
}
