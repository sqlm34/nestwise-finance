import React,{useEffect,useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {apiURL,authenticatedFetch,authenticatedPost} from '../auth/client';
import {parseAccess} from '../domain/live-navigation';
import {operationDraftStore} from '../storage/operation-drafts';
import {DraftRejected,submitDraft,type OperationDraft} from '../domain/operation-draft';
import {parseManualOperation,type ManualOperation} from '../domain/manual-operation';
import {cents} from '../domain/money';
import {journalMoney} from '../domain/journal';
import {useApp} from '../state';
import {Button,Card,Notice,styles} from './ui';
const labels={income:['Income','Доход'],expense:['Expense','Расход'],transfer:['Transfer','Перевод'],refund:['Refund','Возврат']} as const;
const categories={other:['Other','Прочее'],supplies:['Supplies','Материалы'],fuel:['Fuel','Топливо'],utilities:['Utilities','Коммунальные услуги'],insurance:['Insurance','Страховка'],equipment:['Equipment','Оборудование'],groceries:['Groceries','Продукты'],salary:['Salary','Зарплата']} as const;
export function ManualOperationForm({user,workspace,account,accounts,onSaved,onSessionExpired}:{user:string;workspace:string;account:string;
  accounts:{id:string;name:string}[];onSaved:()=>void;onSessionExpired:()=>void}){
  const {locale,offline}=useApp(),ru=locale==='ru';
  const scope=React.useMemo(()=>({origin:apiURL,user,workspace,account}),[user,workspace,account]);
  const [kind,setKind]=useState<ManualOperation['kind']>('expense'),[amount,setAmount]=useState(''),[paid,setPaid]=useState(()=>new Date().toISOString().slice(0,10));
  const [note,setNote]=useState(''),[destination,setDestination]=useState(''),[reference,setReference]=useState('');
  const [splits,setSplits]=useState<{key:string;category:keyof typeof categories;amount:string}[]>([]);
  const [draft,setDraft]=useState<ManualOperation|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const [record,setRecord]=useState<OperationDraft|null>(null),[loading,setLoading]=useState(true),[storageFailed,setStorageFailed]=useState(false);
  const retryOnly=record?.phase==='pending';
  const sending=useRef(false),alive=useRef(true);
  function install(value:OperationDraft|null){
    setRecord(value);setDraft(value?.operation||null);
    if(value){const op=value.operation;setKind(op.kind);setAmount((BigInt(op.amount_cents)/100n).toString()+'.'+(BigInt(op.amount_cents)%100n).toString().padStart(2,'0'));setPaid(op.paid_on);setNote(op.note);setDestination(op.destination_account||'');setReference(op.reference_operation||'');
      setSplits(op.allocations.filter(a=>a.category in categories).map(a=>({key:a.category,category:a.category as keyof typeof categories,amount:(BigInt(a.cents)/100n).toString()+'.'+(BigInt(a.cents)%100n).toString().padStart(2,'0')})));}
  }
  useEffect(()=>{alive.current=true;let active=true;
    operationDraftStore.read(scope).then(value=>{if(active){install(value);setStorageFailed(false);}}).catch(()=>{if(active)setStorageFailed(true);}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;alive.current=false;};
  },[scope]);
  async function recover(){setLoading(true);try{const value=await operationDraftStore.read(scope);if(alive.current){install(value);setStorageFailed(false);setError('');}}catch{if(alive.current)setStorageFailed(true);}finally{if(alive.current)setLoading(false);}}
  async function review(){
    if(sending.current)return;setError('');setSaved('');
    let operation:ManualOperation;
    try{const value=cents(amount).toString();operation=parseManualOperation({id:randomUUID(),kind,paid_on:paid,amount_cents:value,note,
      destination_account:kind==='transfer'?destination:null,reference_operation:kind==='refund'?reference.trim():null,
      allocations:kind==='income'||kind==='expense'?(splits.length?splits.map(s=>({category:s.category,cents:cents(s.amount).toString()})):[{category:kind==='income'?'other_income':'other_expense',cents:value}]):[]});}
    catch{setError(ru?'Проверьте сумму, дату и выбранную исходную операцию или счёт.':'Check the amount, date and original operation or destination account.');return;}
    sending.current=true;setBusy(true);
    try{const value=await operationDraftStore.change(scope,{type:'prepare',operation});if(alive.current)install(value);}
    catch{if(alive.current){setStorageFailed(true);setError(ru?'Черновик не сохранён. Отправка не выполнялась. Обновите локальное состояние.':'Draft was not saved. Nothing was sent. Reload local state.');}}
    finally{sending.current=false;if(alive.current)setBusy(false);}
  }
  async function discard(){
    if(!draft||sending.current)return;sending.current=true;setBusy(true);
    try{await operationDraftStore.change(scope,{type:'discard',operation:draft});if(alive.current){install(null);setError('');if(record?.phase==='confirmed'){setAmount('');setNote('');setSplits([]);setReference('');setDestination('');}}}
    catch{if(alive.current)setStorageFailed(true);}finally{sending.current=false;if(alive.current)setBusy(false);}
  }
  async function save(){
    if(!draft||sending.current||offline)return;sending.current=true;setBusy(true);setError('');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30_000);
    try{
      const value=await submitDraft(operationDraftStore,scope,draft,async()=>{
        const response=await authenticatedFetch('/v1/session',controller.signal);
        if(response.status===401){if(alive.current)onSessionExpired();throw new Error('session');}
        if(!response.ok)throw new Error('access');
        const access=parseAccess(await response.json()),space=access.workspaces.find(w=>w.id===workspace);
        if(access.user.id!==user||!space||!['owner','accountant'].includes(space.role)||!space.accounts.some(a=>a.id===account))throw new Error('access');
        if(!alive.current)throw new Error('left_screen');
      },async operation=>{
        if(alive.current)setRecord(current=>current?{...current,phase:'pending'}:current);
        const response=await authenticatedPost(`/v1/user/workspaces/${workspace}/accounts/${account}/operations`,operation,controller.signal);
        if(response.status===401&&alive.current)onSessionExpired();
        const result=await response.json();
        if((response.status===400&&result.error==='invalid_manual_operation')||(response.status===409&&result.error==='manual_refund_exceeded'))throw new DraftRejected(result.error);
        if(!response.ok)throw new Error('unconfirmed');
        if(result.id!==operation.id)throw new Error('unexpected_response');
      });
      if(alive.current){install(value);setSaved(draft.id);}
    }catch(error){if(alive.current){setError(error instanceof DraftRejected?'':ru?'Подтверждение не получено. Черновик сохранён: восстановите связь и доступ, затем повторите ту же операцию. Не вводите её заново.':'Confirmation was not received. The draft is retained: restore connection and access, then retry this same operation. Do not enter it again.');
      try{const latest=await operationDraftStore.read(scope);if(alive.current)install(latest);}catch{if(alive.current)setStorageFailed(true);}
    }}finally{clearTimeout(timeout);sending.current=false;if(alive.current)setBusy(false);}
  }
  return <Card><Text accessibilityRole="header" style={styles.h2}>{ru?'Новая операция':'New operation'}</Text>
    <Notice text={ru?'Для операций вне CRM. Платежи по заказам повторно не вводите. Перевод здесь — запись в учёте, деньги в банке он не переводит.':'For transactions outside CRM. Do not re-enter job payments. A transfer here records bookkeeping only; it does not move bank funds.'}/>
    {!!error&&<Notice error text={error}/>}{!!saved&&<Notice text={`${ru?'Сохранено':'Saved'} · ${saved}`}/>}
    <Notice text={ru?'Кнопка «Проверить» сохраняет готовый черновик на этом устройстве. После перезапуска войдите и выберите этот счёт. До проверки введённые поля не сохранены.':'Review saves a complete draft on this device. After restarting, sign in and select this account. Fields are not saved before review.'}/>
    {storageFailed&&<><Notice error text={ru?'Локальное хранилище недоступно или изменилось в другой вкладке. Новая отправка заблокирована.':'Local storage is unavailable or changed in another tab. New submission is blocked.'}/><Button label={ru?'Загрузить сохранённый черновик':'Reload saved draft'} disabled={busy||loading} onPress={()=>void recover()}/></>}
    {loading?<Notice text={ru?'Проверка сохранённого черновика…':'Checking saved draft…'}/>:storageFailed?null:draft?<>
      <Text style={styles.h2}>{labels[draft.kind][ru?1:0]} · {journalMoney(draft.amount_cents,locale,'USD')}</Text>
      <Text style={styles.text}>{draft.paid_on} · {draft.note}</Text>
      {draft.allocations.map(a=><Text key={a.category} style={styles.text}>{categories[a.category as keyof typeof categories]?.[ru?1:0]||(ru?'Прочее':'Other')} · {journalMoney(a.cents,locale,'USD')}</Text>)}
      {draft.destination_account&&<Text style={styles.text}>{accounts.find(a=>a.id===draft.destination_account)?.name}</Text>}
      {draft.reference_operation&&<Text selectable style={styles.text}>{ru?'Исходная операция':'Original operation'}: {draft.reference_operation}</Text>}
      <Notice text={ru?'После сохранения запись останется в истории. Исправления выполняются отдельными операциями.':'The saved record remains in history. Corrections require separate operations.'}/>
      <Text selectable style={styles.muted}>{ru?'Номер операции':'Operation ID'}: {draft.id}</Text>
      {record?.phase==='rejected'&&<Notice error text={ru?'Сервер отклонил операцию: проверьте исходный платёж, сумму возврата и дату. Можно вернуться к редактированию.':'Server rejected the operation: check the original payment, refund amount and date. You can return to editing.'}/>}
      {retryOnly&&<Notice text={ru?'Ожидает подтверждения. Данные и номер операции заблокированы для безопасного повтора.':'Awaiting confirmation. Data and operation ID are locked for safe retry.'}/>}
      {record?.phase==='confirmed'?<><Notice text={ru?'Сервер подтвердил запись. Повторная отправка не нужна.':'Server confirmed this record. No resubmission is needed.'}/><Button primary label={ru?'Открыть журнал':'Open journal'} onPress={onSaved}/><Button label={ru?'Начать следующую операцию':'Start next operation'} disabled={busy} onPress={()=>void discard()}/></>:<>
      <Button primary label={retryOnly?(ru?'Повторить ту же операцию':'Retry same operation'):(ru?'Подтвердить и сохранить':'Confirm and save')} disabled={busy||offline||record?.phase==='rejected'} onPress={()=>void save()}/>
      <Button label={ru?'Вернуться к редактированию':'Back to editing'} disabled={busy||retryOnly} onPress={()=>void discard()}/></>}
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
      <Button primary label={ru?'Проверить перед сохранением':'Review before saving'} disabled={busy} onPress={()=>void review()}/>
    </>}
  </Card>;
}
