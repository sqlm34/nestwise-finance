import React,{useEffect,useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {authenticatedPost} from '../auth/client';
import {parseManualOperation,type ManualOperation} from '../domain/manual-operation';
import {cents} from '../domain/money';
import {journalMoney} from '../domain/journal';
import {useApp} from '../state';
import {Button,Card,Notice,styles} from './ui';
const labels={income:['Income','Доход'],expense:['Expense','Расход'],transfer:['Transfer','Перевод'],refund:['Refund','Возврат']} as const;
const categories={other:['Other','Прочее'],supplies:['Supplies','Материалы'],fuel:['Fuel','Топливо'],utilities:['Utilities','Коммунальные услуги'],insurance:['Insurance','Страховка'],equipment:['Equipment','Оборудование'],groceries:['Groceries','Продукты'],salary:['Salary','Зарплата']} as const;
export function ManualOperationForm({workspace,account,accounts,onSaved,onSessionExpired}:{workspace:string;account:string;
  accounts:{id:string;name:string}[];onSaved:()=>void;onSessionExpired:()=>void}){
  const {locale}=useApp(),ru=locale==='ru';
  const [kind,setKind]=useState<ManualOperation['kind']>('expense'),[amount,setAmount]=useState(''),[paid,setPaid]=useState(()=>new Date().toISOString().slice(0,10));
  const [note,setNote]=useState(''),[destination,setDestination]=useState(''),[reference,setReference]=useState('');
  const [splits,setSplits]=useState<{key:string;category:keyof typeof categories;amount:string}[]>([]);
  const [draft,setDraft]=useState<ManualOperation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const [retryOnly,setRetryOnly]=useState(false);
  const sending=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  function review(){
    setError('');setSaved('');
    try{const value=cents(amount).toString();setDraft(parseManualOperation({id:randomUUID(),kind,paid_on:paid,amount_cents:value,note,
      destination_account:kind==='transfer'?destination:null,reference_operation:kind==='refund'?reference.trim():null,
      allocations:kind==='income'||kind==='expense'?(splits.length?splits.map(s=>({category:s.category,cents:cents(s.amount).toString()})):[{category:kind==='income'?'other_income':'other_expense',cents:value}]):[]}));}
    catch{setError(ru?'Проверьте сумму, дату и выбранную исходную операцию или счёт.':'Check the amount, date and original operation or destination account.');}
  }
  async function save(){
    if(!draft||sending.current)return;sending.current=true;setBusy(true);setError('');setRetryOnly(true);
    try{
      const response=await authenticatedPost(`/v1/user/workspaces/${workspace}/accounts/${account}/operations`,draft);
      if(!alive.current)return;
      if(response.status===401){onSessionExpired();return;}
      const result=await response.json();
      if(response.status>=400&&response.status<500)setRetryOnly(false);
      if(!response.ok){setError(result.error==='manual_refund_exceeded'?(ru?'Сумма возврата превышает остаток исходной операции.':'Refund exceeds the original remaining amount.'):
        response.status===404?(ru?'Нет доступа к одному из счетов.':'Access to an account is unavailable.'):
        (ru?'Операция не подтверждена. Повторите с теми же данными; повторный запрос не создаст дубль.':'Operation is not confirmed. Retry the same request; it will not create a duplicate.'));return;}
      if(result.id!==draft.id)throw new Error('unexpected_response');
      setRetryOnly(false);setSaved(draft.id);setDraft(null);setAmount('');setNote('');onSaved();
    }catch{if(alive.current)setError(ru?'Подтверждение не получено. Повторите сохранение этого же черновика.':'Confirmation was not received. Retry saving this same draft.');}
    finally{sending.current=false;if(alive.current)setBusy(false);}
  }
  return <Card><Text accessibilityRole="header" style={styles.h2}>{ru?'Новая операция':'New operation'}</Text>
    <Notice text={ru?'Для операций вне CRM. Платежи по заказам повторно не вводите. Перевод здесь — запись в учёте, деньги в банке он не переводит.':'For transactions outside CRM. Do not re-enter job payments. A transfer here records bookkeeping only; it does not move bank funds.'}/>
    {!!error&&<Notice error text={error}/>}{!!saved&&<Notice text={`${ru?'Сохранено':'Saved'} · ${saved}`}/>}
    {draft?<>
      <Text style={styles.h2}>{labels[draft.kind][ru?1:0]} · {journalMoney(draft.amount_cents,locale,'USD')}</Text>
      <Text style={styles.text}>{draft.paid_on} · {draft.note}</Text>
      {draft.allocations.map(a=><Text key={a.category} style={styles.text}>{categories[a.category as keyof typeof categories]?.[ru?1:0]||(ru?'Прочее':'Other')} · {journalMoney(a.cents,locale,'USD')}</Text>)}
      {draft.destination_account&&<Text style={styles.text}>{accounts.find(a=>a.id===draft.destination_account)?.name}</Text>}
      {draft.reference_operation&&<Text selectable style={styles.text}>{ru?'Исходная операция':'Original operation'}: {draft.reference_operation}</Text>}
      <Notice text={ru?'После сохранения запись останется в истории. Исправления выполняются отдельными операциями.':'The saved record remains in history. Corrections require separate operations.'}/>
      <Button primary label={ru?'Подтвердить и сохранить':'Confirm and save'} disabled={busy} onPress={()=>void save()}/>
      <Button label={ru?'Вернуться к редактированию':'Back to editing'} disabled={busy||retryOnly} onPress={()=>setDraft(null)}/>
    </>:<>
      <View style={styles.row}>{(Object.keys(labels) as ManualOperation['kind'][]).map(k=><Button key={k} label={labels[k][ru?1:0]} selected={kind===k} onPress={()=>setKind(k)}/>)}</View>
      <TextInput accessibilityLabel={ru?'Сумма в долларах':'Amount in dollars'} placeholder={ru?'Сумма USD':'Amount USD'} style={styles.input} keyboardType="decimal-pad" value={amount} onChangeText={setAmount}/>
      <TextInput accessibilityLabel={ru?'Дата YYYY-MM-DD':'Date YYYY-MM-DD'} style={styles.input} value={paid} onChangeText={setPaid} maxLength={10}/>
      <TextInput accessibilityLabel={ru?'Описание':'Description'} placeholder={ru?'Описание':'Description'} style={styles.input} value={note} onChangeText={setNote} maxLength={1000}/>
      {(kind==='income'||kind==='expense')&&<>
        <Notice text={ru?'Категории здесь используются для учёта. Налоговое назначение согласуется отдельно. Сумма частей должна равняться общей сумме.':'These are operational categories. Tax treatment is reviewed separately. Split amounts must equal the total.'}/>
        {splits.map((split,index)=><View key={split.key} style={{gap:8}}>
          <Text style={styles.text}>{ru?'Часть':'Allocation'} {index+1}</Text>
          <View style={styles.row}>{(Object.keys(categories) as (keyof typeof categories)[]).map(category=><Button key={category} label={categories[category][ru?1:0]} selected={split.category===category} onPress={()=>setSplits(current=>current.map(s=>s.key===split.key?{...s,category}:s))}/>)}</View>
          <TextInput accessibilityLabel={`${ru?'Сумма части':'Allocation amount'} ${index+1}`} style={styles.input} keyboardType="decimal-pad" value={split.amount} onChangeText={value=>setSplits(current=>current.map(s=>s.key===split.key?{...s,amount:value}:s))}/>
          <Button label={ru?'Убрать часть':'Remove allocation'} onPress={()=>setSplits(current=>current.filter(s=>s.key!==split.key))}/>
        </View>)}
        <Button label={ru?'Добавить распределение':'Add allocation'} disabled={splits.length>=Object.keys(categories).length} onPress={()=>setSplits(current=>[...current,{key:randomUUID(),category:(Object.keys(categories) as (keyof typeof categories)[]).find(c=>!current.some(s=>s.category===c))||'other',amount:''}])}/>
      </>}
      {kind==='transfer'&&accounts.filter(a=>a.id!==account).map(a=><Button key={a.id} label={a.name} selected={destination===a.id} onPress={()=>setDestination(a.id)}/>)}
      {kind==='refund'&&<TextInput accessibilityLabel={ru?'ID исходной операции':'Original operation ID'} placeholder={ru?'ID исходной операции из журнала':'Original operation ID from journal'} style={styles.input} value={reference} onChangeText={setReference} autoCapitalize="none"/>}
      <Button primary label={ru?'Проверить перед сохранением':'Review before saving'} onPress={review}/>
    </>}
  </Card>;
}
