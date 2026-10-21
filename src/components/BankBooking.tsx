import React,{useEffect,useRef,useState} from 'react';
import {Text} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {authenticatedPost} from '../auth/client';
import type {BankRow} from '../domain/statement';
import {journalMoney} from '../domain/journal';
import {useApp} from '../state';
import {Button,Notice,styles} from './ui';
export function BankBooking({workspace,account,hash,row,onSaved,onSessionExpired}:{workspace:string;account:string;hash:string;row:BankRow;onSaved:()=>void;onSessionExpired:()=>void}){
  const {locale}=useApp(),ru=locale==='ru';const [id,setId]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const alive=useRef(true),sending=useRef(false);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function save(){if(!id||sending.current)return;sending.current=true;setBusy(true);setError(false);
    try{const r=await authenticatedPost(`/v1/user/workspaces/${workspace}/accounts/${account}/documents/${hash}/book`,{id,line:row.line,category:row.amountCents>0?'other_income':'other_expense',confirm_no_existing_entry:true});
      if(!alive.current)return;if(r.status===401){onSessionExpired();return;}if(!r.ok){setError(true);if(r.status>=400&&r.status<500)setId(null);return;}
      const value=await r.json();if(value.id!==id)throw new Error();if(alive.current)onSaved();
    }catch{if(alive.current)setError(true);}finally{sending.current=false;if(alive.current)setBusy(false);}
  }
  return <>
    <Notice text={ru?'Если операция уже есть в CRM, чеке или журнале, сопоставьте её выше. Создавайте новую запись только после проверки существующих операций.':'If this transaction is already in CRM, a receipt or the journal, match it above. Create a new entry only after reviewing existing transactions.'}/>
    {error&&<Notice error text={ru?'Не удалось подтвердить запись. Строка может быть уже занята; обновите данные. Если подтверждение потерялось, повторите тот же запрос.':'Could not confirm booking. The row may be reserved; refresh the data. If confirmation was lost, retry the same request.'}/>}
    {id?<>
      <Text style={styles.h2}>{row.description} · {journalMoney(row.amountCents.toString(),locale,'USD')} · {row.date}</Text>
      <Notice text={ru?'Подтверждаю, что этой операции ещё нет в учёте. Будет создана запись и сохранена связь с оригиналом выписки.':'I confirm this transaction is not already recorded. A journal entry and its link to the original statement will be saved.'}/>
      <Button primary label={ru?'Подтвердить новую операцию':'Confirm new transaction'} disabled={busy} onPress={()=>void save()}/>
      <Button label={ru?'Отмена':'Cancel'} disabled={busy||error} onPress={()=>setId(null)}/>
    </>:<Button label={ru?'Создать новую операцию по этой строке':'Book a new transaction from this row'} onPress={()=>setId(randomUUID())}/>}
  </>;
}
