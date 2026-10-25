import React,{useEffect,useRef,useState} from 'react';
import {Image,Platform,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {authenticatedFetch,authenticatedPost,authenticatedUpload} from '../auth/client';
import {captureReceipt,readReceiptFile,saveReceiptOriginal,type ReceiptFile} from '../receipt-file';
import {parseReceipt,type ReceiptData} from '../domain/receipt';
import {cents} from '../domain/money';
import {ReceiptPosting} from './ReceiptPosting';
import {useApp} from '../state';
import {Button,Card,Notice,styles} from './ui';
import {ReceiptAiReview} from './ReceiptAiReview';
import {receiptReviewChecks,possibleReceiptDuplicates,sameReceiptData} from '../domain/receipt-review';
import {receiptTitle,receiptStage,receiptStageLabel,receiptAmount,receiptMatches,type ReceiptStage} from '../domain/receipt-inbox';
type Receipt={hash:string;bytes:number;mime:string;archived:boolean;operation_id:string|null;review:{id:string;revision:number;data:ReceiptData}|null};
const empty=():ReceiptData=>({supplier:'',date:'',currency:'USD',items:[],tax_cents:null,tip_cents:null,shipping_cents:null,discount_cents:null,total_cents:null});
const moneyFields=['tax_cents','tip_cents','shipping_cents','discount_cents','total_cents'] as const;
const moneyLabels={tax_cents:['Tax','Налог'],tip_cents:['Tip','Чаевые'],shipping_cents:['Shipping','Доставка'],discount_cents:['Discount','Скидка'],total_cents:['Total','Итого']} as const;
const decimal=(v:string|null)=>v===null?'':`${BigInt(v)/100n}.${(BigInt(v)%100n).toString().padStart(2,'0')}`;
export function AccountReceipts({workspace,account,business,canWrite,onSessionExpired}:{workspace:string;account:string;business:boolean;canWrite:boolean;onSessionExpired:()=>void}){
  const {locale}=useApp(),ru=locale==='ru';
  const [rows,setRows]=useState<Receipt[]>([]),[revision,setRevision]=useState(0),[selected,setSelected]=useState<Receipt|null>(null);
  const [before,setBefore]=useState<string|null>(null),[loadedKey,setLoadedKey]=useState('');
  const [form,setForm]=useState(empty),[money,setMoney]=useState<Record<string,string>>({}),[items,setItems]=useState<{description:string;amount:string;key:string}[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[preview,setPreview]=useState('');
  const [pending,setPending]=useState<{mode:'review'|'post';body:unknown;summary?:string}|null>(null);
  const [upload,setUpload]=useState<ReceiptFile|null>(null);
  const [query,setQuery]=useState(''),[stage,setStage]=useState<ReceiptStage|'all'>('all'),[technical,setTechnical]=useState(false);
  const alive=useRef(true),sending=useRef(false),path=`/v1/user/workspaces/${workspace}/accounts/${account}/receipts`;
  const loadKey=`${path}:${before}:${revision}:${ru}`,loading=loadedKey!==loadKey;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{const controller=new AbortController();let active=true;
    void authenticatedFetch(path+(before?`?before=${before}`:''),controller.signal).then(async r=>{if(r.status===401){onSessionExpired();return;}if(!r.ok)throw new Error();const values=await r.json();
      if(!Array.isArray(values)||values.length>100)throw new Error();for(const value of values){if(!/^[0-9a-f]{64}$/.test(value.hash))throw new Error();if(value.review)parseReceipt(value.review.data);}if(active){setRows(values);setError('');}
    }).catch(()=>{if(active)setError(ru?'Не удалось загрузить чеки.':'Could not load receipts.');}).finally(()=>{if(active)setLoadedKey(loadKey);});
    return()=>{active=false;controller.abort();};
  },[path,before,revision,onSessionExpired,ru,loadKey]);
  function fill(data:ReceiptData){setForm(data);setMoney(Object.fromEntries(moneyFields.map(k=>[k,decimal(data[k])])));setItems(data.items.map(i=>({key:randomUUID(),description:i.description,amount:decimal(i.cents)})));}
  function open(row:Receipt){setSelected(row);fill(row.review?.data||empty());setPending(null);setError('');setPreview('');setTechnical(false);}
  async function action(task:()=>Promise<void>){if(sending.current)return;sending.current=true;setBusy(true);setError('');try{await task();}catch{if(alive.current)setError(ru?'Действие не подтверждено. Повторите запрос с теми же данными.':'Action is not confirmed. Retry the same request.');}finally{sending.current=false;if(alive.current)setBusy(false);}}
  async function responseData(response:Response){if(response.status===401){onSessionExpired();throw new Error();}if(!response.ok){const v=await response.json();if(response.status>=400&&response.status<500&&alive.current)setPending(null);if(v.error==='ocr_not_configured')throw new Error('ocr_not_configured');throw new Error();}return response.json();}
  function currentData(){const amount=(s:string|undefined)=>s?.trim()?cents(s).toString():null;
    return parseReceipt({...form,...Object.fromEntries(moneyFields.map(k=>[k,amount(money[k])])),items:items.map(i=>({description:i.description,cents:amount(i.amount)}))});}
  let dirty=true;try{dirty=!sameReceiptData(currentData(),selected?.review?.data);}catch{/* Invalid edits cannot be posted. */}
  let checks:ReturnType<typeof receiptReviewChecks>|null=null,duplicates:string[]=[];
  try{const data=currentData();checks=receiptReviewChecks(data);duplicates=possibleReceiptDuplicates(data,selected?.hash||'',rows);}catch{/* Invalid edits remain in the editor. */}
  function prepareReview(){try{
    const data=currentData();
    setPending({mode:'review',body:{id:randomUUID(),expected:selected?.review?.revision||0,data}});setError('');
  }catch{setError(ru?'Проверьте поля. Пустая сумма означает «неизвестно», ноль вводится явно.':'Check the fields. An empty amount means unknown; enter zero explicitly.');}}
  async function save(){if(!selected||!pending)return;await action(async()=>{await responseData(await authenticatedPost(`${path}/${selected.hash}/${pending.mode}`,pending.body));if(!alive.current)return;
    const values=await responseData(await authenticatedFetch(`${path}/${selected.hash}`));if(!alive.current)return;open(values[0]);setRevision(v=>v+1);
  });}
  return <Card><Text accessibilityRole="header" style={styles.h2}>{ru?'Чеки и документы':'Receipts and documents'}</Text>
    <Notice text={ru?'Загрузка и сохранение проверенных данных не создают расход. Подтверждайте оплату только если она ещё не учтена в CRM или журнале.':'Uploading and saving reviewed details do not book an expense. Confirm payment only if it is not already recorded in CRM or the journal.'}/>
    {!!error&&<Notice error text={error}/>}
    {canWrite&&<>{upload?<>
      <Notice text={`${upload.name} · ${upload.bytes.length} bytes · ${ru?'Подтвердите загрузку оригинала.':'Confirm original upload.'}`}/>
      <Button primary label={ru?'Загрузить / повторить':'Upload / retry'} disabled={busy||!!pending} onPress={()=>void action(async()=>{
        await responseData(await authenticatedUpload(`${path}/${upload.hash}/original`,upload.bytes,'application/octet-stream'));
        const values=await responseData(await authenticatedFetch(`${path}/${upload.hash}`));if(alive.current){open(values[0]);setUpload(null);setBefore(null);setRevision(v=>v+1);}
      })}/>
      <Button label={ru?'Закрыть файл':'Dismiss file'} disabled={busy} onPress={()=>setUpload(null)}/>
    </>:<>
      <Button label={ru?'Выбрать фото или PDF':'Choose image or PDF'} disabled={busy||!!pending} onPress={()=>void action(async()=>{const file=await readReceiptFile();if(alive.current)setUpload(file);})}/>
      <Button label={ru?'Сфотографировать чек':'Photograph receipt'} disabled={busy||!!pending} onPress={()=>void action(async()=>{const file=await captureReceipt();if(alive.current)setUpload(file);})}/>
      {Platform.OS==='android'&&<Button label={ru?'Восстановить фото после перезапуска':'Recover photo after restart'} disabled={busy||!!pending} onPress={()=>void action(async()=>{const file=await captureReceipt(true);if(alive.current)setUpload(file);})}/>}
    </>}</>}
    {!selected?<>
      <TextInput accessibilityLabel={ru?'Поиск чеков на странице':'Search receipts on this page'} placeholder={ru?'Продавец, дата, сумма или позиция':'Supplier, date, amount or item'} style={styles.input} value={query} onChangeText={setQuery}/>
      <Text style={styles.muted}>{ru?'Поиск и фильтры относятся к загруженной странице (до 100 чеков).':'Search and filters cover the loaded page (up to 100 receipts).'}</Text>
      {(['all','upload','review','payment','posted'] as const).map(value=><Button key={value} label={`${stage===value?'✓ ':''}${value==='all'?(ru?'Все чеки':'All receipts'):receiptStageLabel(value,ru)} (${rows.filter(row=>value==='all'||receiptStage(row)===value).length})`} disabled={busy||loading} onPress={()=>setStage(value)}/>)}
      <Button label={ru?'Обновить список':'Refresh list'} disabled={busy||loading} onPress={()=>setRevision(v=>v+1)}/>
      {rows.filter(row=>receiptMatches(row,query,stage)).map(row=><Button key={row.hash} label={[receiptTitle(row,ru),row.review?.data.date,receiptAmount(row.review?.data.total_cents),receiptStageLabel(receiptStage(row),ru)].filter(Boolean).join(' · ')} disabled={busy||loading} onPress={()=>open(row)}/>)}
      {!loading&&rows.length>0&&!rows.some(row=>receiptMatches(row,query,stage))&&<Notice text={ru?'На этой странице совпадений нет. Измените поиск или откройте другую страницу.':'No matches on this page. Change the search or open another page.'}/>}
      {loading&&<Text style={styles.muted}>{ru?'Загрузка…':'Loading…'}</Text>}
      {!!before&&<Button label={ru?'К новым чекам':'Newest receipts'} disabled={busy||loading} onPress={()=>setBefore(null)}/>}
      {rows.length===100&&<Button label={ru?'Более ранние чеки':'Older receipts'} disabled={busy||loading||!!error} onPress={()=>setBefore(rows[rows.length-1].hash)}/>}
      {!loading&&rows.length===0&&<Text style={styles.muted}>{ru?'Чеков на этой странице нет.':'No receipts on this page.'}</Text>}
    </>:<>
      <Button label={ru?'К списку':'Back to list'} disabled={busy||!!pending} onPress={()=>setSelected(null)}/>
      <Text style={styles.h2}>{receiptTitle(selected,ru)}</Text>
      <Notice text={receiptStageLabel(receiptStage(selected),ru)}/>
      <Button label={technical?(ru?'Скрыть технические сведения':'Hide technical details'):(ru?'Технические сведения':'Technical details')} onPress={()=>setTechnical(v=>!v)}/>
      {technical&&<Text selectable style={styles.muted}>{ru?'Идентификатор оригинала SHA-256 (не содержимое чека)':'Original SHA-256 identifier (not receipt contents)'}: {selected.hash}{'\n'}{selected.mime} · {selected.bytes} {ru?'байт':'bytes'}{selected.operation_id?`\n${ru?'Операция журнала':'Journal operation'}: ${selected.operation_id}`:''}</Text>}
      <Button label={ru?'Сохранить оригинал / открыть в приложении':'Save original / open in app'} disabled={busy||!selected.archived} onPress={()=>void action(async()=>{
        const r=await authenticatedFetch(`${path}/${selected.hash}/original`);if(r.status===401){onSessionExpired();return;}if(!r.ok)throw new Error();
        await saveReceiptOriginal(new Uint8Array(await r.arrayBuffer()),selected.hash);
      })}/>
      {selected.review&&<Text style={styles.text}>{selected.review.data.supplier} · {selected.review.data.date} · {decimal(selected.review.data.total_cents)} USD · {ru?'Версия':'Version'} {selected.review.revision}</Text>}
      {selected.mime.startsWith('image/')&&<Button label={ru?'Показать оригинал':'Show original'} disabled={busy} onPress={()=>void action(async()=>{
        const r=await authenticatedFetch(`${path}/${selected.hash}/original`);if(r.status===401){onSessionExpired();return;}if(!r.ok)throw new Error();
        const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>5_000_000)throw new Error();let raw='';for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.slice(i,i+8192));if(alive.current)setPreview(`data:${selected.mime};base64,${btoa(raw)}`);
      })}/>}
      {!!preview&&<Image accessibilityLabel={ru?'Оригинал чека':'Original receipt'} source={{uri:preview}} resizeMode="contain" style={{width:'100%',height:420}}/>}
      {selected.operation_id?<Notice text={ru?'Оплата уже внесена в журнал. Категории и итог доступны в отчётах. Повторно создавать расход не нужно.':'Payment is already in the journal. Categories and totals are available in reports. Do not record this expense again.'}/>:canWrite&&selected.archived?<>
        {pending&&<>
          <Notice text={pending.mode==='post'?(ru?'Подтвердите: оплата действительно произведена в указанную дату и ещё не внесена в журнал.':'Confirm: payment was made on the stated date and is not already in the journal.'):(ru?'Сохранить новую версию проверенных данных? Расход пока не создаётся.':'Save a new review version? This does not book an expense.')}/>
          {pending.summary&&<Text selectable style={styles.text}>{pending.summary}</Text>}
          <Button primary label={ru?'Подтвердить':'Confirm'} disabled={busy} onPress={()=>void save()}/>
          <Button label={ru?'Отмена':'Cancel'} disabled={busy||!!error} onPress={()=>setPending(null)}/>
        </>}
        <View style={{display:pending?'none':'flex',gap:8}}>
          <ReceiptAiReview key={selected.hash} path={`${path}/${selected.hash}/ocr`} ru={ru} disabled={busy} onApply={fill} onBusy={setBusy} onSessionExpired={onSessionExpired}/>
          <Notice text={ru?'Сверьте данные с оригиналом и заполните поля вручную. Пустая сумма означает «неизвестно»; если сбора нет, укажите 0.':'Check the original and enter its details manually. An empty amount means unknown; enter 0 when a charge does not apply.'}/>
          <TextInput accessibilityLabel={ru?'Продавец':'Supplier'} placeholder={ru?'Продавец':'Supplier'} style={styles.input} value={form.supplier} onChangeText={supplier=>setForm(f=>({...f,supplier}))}/>
          <TextInput accessibilityLabel={ru?'Дата чека YYYY-MM-DD':'Receipt date YYYY-MM-DD'} placeholder="YYYY-MM-DD" style={styles.input} value={form.date} onChangeText={date=>setForm(f=>({...f,date}))}/>
          {items.map((item,i)=><View key={item.key} style={{gap:6}}><TextInput accessibilityLabel={`${ru?'Позиция':'Item'} ${i+1}`} style={styles.input} value={item.description} onChangeText={description=>setItems(v=>v.map(x=>x.key===item.key?{...x,description}:x))}/>
            <TextInput accessibilityLabel={`${ru?'Сумма позиции':'Item amount'} ${i+1}`} style={styles.input} keyboardType="decimal-pad" value={item.amount} onChangeText={amount=>setItems(v=>v.map(x=>x.key===item.key?{...x,amount}:x))}/>
            <Button label={ru?'Убрать позицию':'Remove item'} onPress={()=>setItems(v=>v.filter(x=>x.key!==item.key))}/></View>)}
          <Button label={ru?'Добавить позицию':'Add item'} disabled={items.length>=100} onPress={()=>setItems(v=>[...v,{key:randomUUID(),description:'',amount:''}])}/>
          {moneyFields.map(k=><View key={k}><Text style={styles.text}>{moneyLabels[k][ru?1:0]} · USD</Text><TextInput accessibilityLabel={moneyLabels[k][ru?1:0]} style={styles.input} keyboardType="decimal-pad" value={money[k]||''} onChangeText={value=>setMoney(v=>({...v,[k]:value}))}/></View>)}
          <Button label={ru?'Проверить и сохранить версию':'Review and save version'} disabled={busy} onPress={prepareReview}/>
          {checks&&checks.missing.length>0&&<Notice text={ru?`Не заполнено полей: ${checks.missing.length}. Неизвестные суммы не заменяются нулём автоматически.`:`Missing fields: ${checks.missing.length}. Unknown amounts are not automatically replaced with zero.`}/>}
          {checks?.totalsMatch===false&&<Notice error text={ru?'Сумма позиций и сборов с учётом скидки не совпадает с итогом. Проверьте оригинал.':'Items and charges less discount do not match the total. Check the original.'}/>}
          {duplicates.length>0&&<Notice error text={ru?`В загруженном списке есть похожие чеки: ${duplicates.map(h=>h.slice(0,12)).join(', ')}. Проверьте, не учтена ли покупка раньше.`:`Similar receipts on the loaded page: ${duplicates.map(h=>h.slice(0,12)).join(', ')}. Check whether the purchase was already recorded.`}/>}
          {!!selected.review&&<ReceiptPosting key={selected.review.id} data={selected.review.data} review={selected.review.id} business={business} ru={ru} disabled={busy||dirty} onPrepare={(body,summary)=>{setPending({mode:'post',body,summary});setError('');}}/>}
        </View>
      </>:null}
    </>}
  </Card>;
}
