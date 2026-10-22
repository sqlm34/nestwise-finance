import React,{useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {cents} from '../domain/money';
import {prepareReceiptPosting,receiptCategories} from '../domain/receipt-posting';
import type {ReceiptData} from '../domain/receipt';
import {Button,Notice,styles} from './ui';

export function ReceiptPosting({data,review,business,ru,disabled,onPrepare}:{data:ReceiptData;review:string;business:boolean;ru:boolean;disabled:boolean;
  onPrepare:(body:ReturnType<typeof prepareReceiptPosting>,summary:string)=>void}){
  const [paid,setPaid]=useState(''),[categorize,setCategorize]=useState(false),[query,setQuery]=useState('');
  const [choosing,setChoosing]=useState(false),[splits,setSplits]=useState<{category:string;amount:string}[]>([]),[error,setError]=useState('');
  const label=(id:string)=>receiptCategories.find(c=>c.id===id)?.[ru?'ru':'en']||id;
  const total=data.total_cents===null?null:BigInt(data.total_cents);
  let remaining:bigint|null=null;
  try{if(total!==null)remaining=total-splits.reduce((sum,row)=>sum+BigInt(cents(row.amount)),0n);}catch{/* Invalid amounts are left for review. */}
  function prepare(){try{
    const body=prepareReceiptPosting(data,review,randomUUID(),paid,business&&categorize?splits.map(s=>({category:s.category,cents:cents(s.amount).toString()})):undefined);
    const summary=[`${data.supplier} · ${paid} · ${total===null?'—':format(total)} USD`,...(body.allocations?.map(a=>`${label(a.category)}: ${format(BigInt(a.cents))} USD`)??[ru?'Категории Statement не назначены.':'Statement categories are not assigned.'])].join('\n');
    setError('');onPrepare(body,summary);
  }catch{setError(ru?'Проверьте дату оплаты и суммы. Категории должны покрывать весь итог чека без повторов и нулевых сумм.':'Check the payment date and amounts. Categories must cover the entire receipt total without duplicates or zero amounts.');}}
  const options=receiptCategories.filter(c=>!splits.some(s=>s.category===c.id)&&`${c.ru} ${c.en}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <View style={{gap:8}}>
    <Text style={styles.h2}>{ru?'Учёт оплаты':'Record payment'}</Text>
    <Notice text={ru?'Чек не доказывает, что расход ещё не внесён. Если покупка уже есть в банковском журнале, CRM или учёте запчастей, не создавайте её повторно.':'A receipt does not establish that the expense is unrecorded. Do not book it again if it is already in the bank journal, CRM or parts purchase records.'}/>
    <TextInput accessibilityLabel={ru?'Дата фактической оплаты YYYY-MM-DD':'Actual payment date YYYY-MM-DD'} placeholder={ru?'Дата оплаты YYYY-MM-DD':'Payment date YYYY-MM-DD'} style={styles.input} value={paid} editable={!disabled} onChangeText={setPaid}/>
    {business?<>
      <Button label={categorize?(ru?'Назначить категории позже':'Assign categories later'):(ru?'Распределить по категориям Statement':'Allocate to Statement categories')} disabled={disabled} onPress={()=>{setCategorize(v=>!v);setError('');}}/>
      {categorize?<>
        <Notice text={ru?'Выберите категории и суммы с учётом налогов, доставки и скидки. ИИ не назначает категории. Это подготовка Statement, без расчёта налогового вычета.':'Choose categories and amounts including tax, shipping and discounts. AI does not assign categories. This prepares the Statement without calculating tax deductibility.'}/>
        {splits.map(row=><View key={row.category} style={{gap:4}}>
          <Text style={styles.text}>{label(row.category)}</Text>
          <TextInput accessibilityLabel={`${label(row.category)} USD`} style={styles.input} keyboardType="decimal-pad" value={row.amount} editable={!disabled} onChangeText={amount=>setSplits(v=>v.map(s=>s.category===row.category?{...s,amount}:s))}/>
          <Button label={`${ru?'Убрать':'Remove'}: ${label(row.category)}`} disabled={disabled} onPress={()=>setSplits(v=>v.filter(s=>s.category!==row.category))}/>
        </View>)}
        {remaining!==null&&<Text accessibilityRole="status" style={styles.text}>{ru?'Осталось распределить':'Remaining to allocate'}: {format(remaining)} USD</Text>}
        <Button label={choosing?(ru?'Закрыть выбор категорий':'Close category picker'):(ru?'Добавить категорию':'Add category')} disabled={disabled||splits.length>=43} onPress={()=>setChoosing(v=>!v)}/>
        {choosing&&<>
          <TextInput accessibilityLabel={ru?'Поиск категории':'Search categories'} placeholder={ru?'Название категории':'Category name'} style={styles.input} value={query} onChangeText={setQuery} editable={!disabled}/>
          {options.map(c=><Button key={c.id} label={c[ru?'ru':'en']} disabled={disabled} onPress={()=>{setSplits(v=>[...v,{category:c.id,amount:''}]);setChoosing(false);setQuery('');}}/>)}
          {!options.length&&<Text style={styles.muted}>{ru?'Категории не найдены.':'No categories found.'}</Text>}
        </>}
      </>:<Notice text={ru?'Расход сохранится без распределения Statement. Его можно выполнить позже в отчёте.':'The expense will be saved without Statement allocation. You can assign it later in the report.'}/>}
    </>:<Notice text={ru?'Это личный или семейный счёт: бизнес-Statement здесь не создаётся. Деловую часть покупки можно отдельно связать с бизнесом в отчётах.':'This is a personal or family account: no business Statement allocation is created here. A business share can be linked separately in reports.'}/>}
    {!!error&&<Notice error text={error}/>}
    <Button label={ru?'Создать расход из сохранённой версии':'Book expense from saved version'} disabled={disabled} onPress={prepare}/>
  </View>;
}
function format(value:bigint){const sign=value<0n?'-':'';const n=value<0n?-value:value;return `${sign}${n/100n}.${(n%100n).toString().padStart(2,'0')}`;}
