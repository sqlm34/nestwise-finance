import React,{useEffect,useRef,useState} from 'react';
import {Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {authenticatedFetch,authenticatedPost,authenticatedUpload} from '../auth/client';
import {readReceiptFile,saveReceiptOriginal,type ReceiptFile} from '../receipt-file';
import {parsePdfStatement,statementChecks,type PdfStatement} from '../domain/personal-documents';
import {cents} from '../domain/money';
import {exactUsd} from '../domain/exact-money';
import {useApp} from '../state';
import {useBackStep} from '../back-navigation';
import {Button,Card,Notice,styles} from './ui';
type Stored={hash:string;bytes:number;archived:boolean;revision:number;data:PdfStatement|null};
const decimal=(s:string|null)=>{if(s===null)return '';const n=BigInt(s),a=n<0n?-n:n;return `${n<0n?'-':''}${a/100n}.${String(a%100n).padStart(2,'0')}`;};
const empty=():PdfStatement=>({bank:'',mask:'',from:'',to:'',currency:'USD',opening_cents:null,closing_cents:null,complete:false,rows:[]});
export function PersonalStatements({workspace,account,name,canWrite,onSessionExpired}:{workspace:string;account:string;name:string;canWrite:boolean;onSessionExpired:()=>void}){
 const {locale}=useApp(),ru=locale==='ru';const [docs,setDocs]=useState<Stored[]>([]),[selected,setSelected]=useState<Stored|null>(null),[upload,setUpload]=useState<ReceiptFile|null>(null);
 const [draft,setDraft]=useState<PdfStatement>(empty),[amounts,setAmounts]=useState<string[]>([]),[opening,setOpening]=useState(''),[closing,setClosing]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[consent,setConsent]=useState(false),[ocr,setOcr]=useState(false),[page,setPage]=useState(0);
 const [bankRows,setBankRows]=useState<{paid_on:string;cents:string;name:string}[]>([]),[bankMask,setBankMask]=useState('');
 const alive=useRef(true),sending=useRef(false);const [pending,setPending]=useState<{id:string;expected:number;data:PdfStatement}|null>(null);
 const path=`/v1/user/workspaces/${workspace}/accounts/${account}/personal-statements`;
 useBackStep(!!selected,()=>{if(!busy&&!pending)setSelected(null);},20);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 async function json(r:Response){if(r.status===401){onSessionExpired();throw Error();}const v=await r.json();if(!r.ok)throw Error(v.error);return v;}
 async function reload(){const v=await json(await authenticatedFetch(path));if(!Array.isArray(v.documents))throw Error();if(alive.current){setDocs(v.documents);setOcr(v.ocr===true);}}
 useEffect(()=>{let active=true;void authenticatedFetch(path).then(json).then(v=>{if(active){setDocs(v.documents);setOcr(v.ocr===true);}}).catch(()=>{if(active)setError(ru?'Не удалось загрузить архив.':'Could not load the archive.');});return()=>{active=false;};},[path,ru,onSessionExpired]); // eslint-disable-line react-hooks/exhaustive-deps
 async function action(task:()=>Promise<void>){if(sending.current)return;sending.current=true;setBusy(true);setError('');setNotice('');try{await task();}catch(e){if(alive.current)setError(e instanceof Error&&e.message==='ocr_rate_limited'?(ru?'Лимит распознавания: попробуйте позже.':'Recognition limit reached. Try later.'):(ru?'Действие не завершено. Проверьте файл и повторите. Распознавание автоматически не повторяется.':'Action did not complete. Check the file and retry. Recognition is not retried automatically.'));}finally{sending.current=false;if(alive.current)setBusy(false);}}
 function fill(d:PdfStatement){setBankRows([]);setBankMask('');setDraft(d);setAmounts(d.rows.map(r=>decimal(r.cents)));setOpening(decimal(d.opening_cents));setClosing(decimal(d.closing_cents));setPage(0);}
 function open(d:Stored){setSelected(d);fill(d.data?parsePdfStatement(d.data):empty());setConsent(false);setPending(null);setError('');setNotice('');}
 function current(){return parsePdfStatement({...draft,opening_cents:opening.trim()?cents(opening).toString():null,closing_cents:closing.trim()?cents(closing).toString():null,rows:draft.rows.map((r,i)=>({...r,cents:amounts[i]?.trim()?cents(amounts[i]).toString():null}))});}
 useEffect(()=>{if(!draft.from||!draft.to)return;let active=true;const controller=new AbortController();
  void authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/bank-feed?from=${draft.from}&to=${draft.to}`,controller.signal).then(json).then(v=>{if(active){setBankRows(v.rows);setBankMask(v.connection?.mask||'');}}).catch(()=>{});return()=>{active=false;controller.abort();};
 },[workspace,account,draft.from,draft.to,onSessionExpired]); // eslint-disable-line react-hooks/exhaustive-deps
 let checks:ReturnType<typeof statementChecks>|null=null;try{checks=statementChecks(current(),bankMask);}catch{/* Editing may be incomplete. */}
 const canSave=checks?.complete&&!checks.wrongAccount&&checks.balanced!==false;
 return <Card><Text style={styles.h2}>{ru?'Выписки банка · PDF':'Bank statements · PDF'}</Text><Text style={styles.text}>{name}</Text>
  <Notice text={ru?'Архив относится только к этому личному счёту. PDF сохраняется отдельно от операций Plaid: повторная выписка не создаёт повторные списания.':'This archive belongs only to this personal account. PDFs are stored separately from Plaid transactions, so a repeated statement does not duplicate withdrawals.'}/>
  {!!error&&<Notice error text={error}/>} {!!notice&&<Notice text={notice}/>}
  {!selected?<>
   {canWrite&&<Button primary label={ru?'Загрузить выписку PDF':'Upload PDF statement'} disabled={busy} onPress={()=>void action(async()=>{const f=await readReceiptFile(true);if(alive.current)setUpload(f);})}/>}
   {upload&&<><Text style={styles.text}>{upload.name} · {Math.ceil(upload.bytes.length/1024)} KB</Text><Button primary label={ru?'Сохранить PDF в этот счёт':'Save PDF to this account'} disabled={busy} onPress={()=>void action(async()=>{const d=await json(await authenticatedUpload(`${path}/${upload.hash}/original`,upload.bytes,'application/pdf'));if(alive.current){open(d);setUpload(null);}await reload();})}/><Button label={ru?'Отмена':'Cancel'} disabled={busy} onPress={()=>setUpload(null)}/></>}
   <Text style={styles.muted}>{ru?'PDF до 5 МБ. Распознавание — до 300 операций за один файл.':'PDF up to 5 MB. Recognition supports up to 300 transactions per file.'}</Text>
   {docs.map(d=><Button key={d.hash} label={d.data?`${d.data.bank||name} · ${d.data.from} — ${d.data.to} · ${d.data.rows.length} ${ru?'операций':'transactions'}`:`${ru?'PDF · нужно распознать':'PDF · awaiting recognition'} · ${d.hash.slice(0,8)}`} disabled={busy} onPress={()=>open(d)}/>)}
   {!docs.length&&<Text style={styles.muted}>{ru?'Выписок пока нет.':'No statements yet.'}</Text>}
  </>:<>
   <Button label={ru?'К выпискам':'Back to statements'} disabled={busy} onPress={()=>setSelected(null)}/>
   <Button label={ru?'Открыть / скачать исходный PDF':'Open / download original PDF'} disabled={busy||!selected.archived} onPress={()=>void action(async()=>{const r=await authenticatedFetch(`${path}/${selected.hash}/original`);if(r.status===401){onSessionExpired();return;}if(!r.ok)throw Error();await saveReceiptOriginal(new Uint8Array(await r.arrayBuffer()),selected.hash);})}/>
   {canWrite&&<>
    {ocr?<Button label={ru?'Распознать выписку с ИИ':'Recognize statement with AI'} disabled={busy||!!pending} onPress={()=>setConsent(true)}/>:<Notice text={ru?'Распознавание временно недоступно. PDF сохранён.':'Recognition is unavailable. Your PDF is saved.'}/>}
    {consent&&<><Notice text={ru?'Весь выбранный PDF будет отправлен в OpenAI для распознавания. Это платный запрос API. Проверьте все строки перед сохранением.':'The selected PDF will be sent to OpenAI for a paid API recognition request. Review all rows before saving.'}/><Button primary label={ru?'Отправить и распознать':'Send and recognize'} disabled={busy} onPress={()=>void action(async()=>{setConsent(false);const v=await json(await authenticatedPost(`${path}/${selected.hash}/ocr`,{consent:true},undefined,70_000));if(v.review_required!==true)throw Error();if(alive.current)fill(parsePdfStatement(v.data));})}/><Button label={ru?'Отмена':'Cancel'} disabled={busy} onPress={()=>setConsent(false)}/></>}
   </>}
   <Text style={styles.muted}>{ru?'Поступления — положительные суммы, списания — отрицательные.':'Money in is positive; money out is negative.'}</Text>
   {(['bank','mask','from','to'] as const).map(k=><TextInput key={k} accessibilityLabel={{bank:ru?'Банк':'Bank',mask:ru?'Последние 4 цифры':'Last 4 digits',from:ru?'Начало периода':'Period start',to:ru?'Конец периода':'Period end'}[k]} placeholder={{bank:ru?'Банк':'Bank',mask:'5599',from:'YYYY-MM-DD',to:'YYYY-MM-DD'}[k]} style={styles.input} value={draft[k]} editable={canWrite&&!busy&&!pending} onChangeText={v=>setDraft(d=>({...d,[k]:v}))}/>)}
   <TextInput accessibilityLabel={ru?'Начальный баланс':'Opening balance'} placeholder={ru?'Начальный баланс':'Opening balance'} style={styles.input} value={opening} editable={canWrite&&!busy&&!pending} onChangeText={setOpening}/>
   <TextInput accessibilityLabel={ru?'Конечный баланс':'Closing balance'} placeholder={ru?'Конечный баланс':'Closing balance'} style={styles.input} value={closing} editable={canWrite&&!busy&&!pending} onChangeText={setClosing}/>
   {draft.rows.slice(page*20,page*20+20).map((row,index)=>{const i=page*20+index;let editedAmount:string|null=null;try{editedAmount=amounts[i]?.trim()?cents(amounts[i]).toString():null;}catch{/* Incomplete amount. */}const matches=bankRows.filter(b=>b.paid_on===row.date&&b.cents===editedAmount);return <View key={i} style={{gap:5,paddingVertical:8}}>
    <Text style={styles.text}>#{i+1}</Text><TextInput accessibilityLabel={`${ru?'Дата строки':'Row date'} ${i+1}`} style={styles.input} value={row.date} editable={canWrite&&!busy&&!pending} onChangeText={date=>setDraft(d=>({...d,rows:d.rows.map((r,n)=>n===i?{...r,date}:r)}))}/>
    <TextInput accessibilityLabel={`${ru?'Описание строки':'Row description'} ${i+1}`} style={styles.input} value={row.description} editable={canWrite&&!busy&&!pending} onChangeText={description=>setDraft(d=>({...d,rows:d.rows.map((r,n)=>n===i?{...r,description}:r)}))}/>
    <TextInput accessibilityLabel={`${ru?'Сумма строки':'Row amount'} ${i+1}`} style={styles.input} value={amounts[i]||''} editable={canWrite&&!busy&&!pending} onChangeText={v=>setAmounts(a=>a.map((x,n)=>n===i?v:x))}/>
    {!!matches.length&&<Text style={styles.muted}>{ru?'В банке есть совпадение даты и суммы — проверьте описание: ':'Bank date/amount match — check the description: '}{matches.map(m=>m.name).join('; ')}</Text>}
   </View>;})}
   <View style={styles.row}><Button label="←" disabled={page===0} onPress={()=>setPage(p=>p-1)}/><Text>{page+1} / {Math.max(1,Math.ceil(draft.rows.length/20))}</Text><Button label="→" disabled={(page+1)*20>=draft.rows.length} onPress={()=>setPage(p=>p+1)}/></View>
   {checks?.wrongAccount&&<Notice error text={ru?'Последние цифры счёта не совпадают. Загрузите PDF в правильный банковский счёт.':'Account digits do not match. Upload the PDF to the correct bank account.'}/>}
   {checks?.balanced===false&&<Notice error text={ru?'Баланс не сходится с операциями. Проверьте пропущенные строки и знаки сумм.':'Balances do not reconcile with transactions. Check missing rows and amount signs.'}/>}
   {checks?.balanced===true&&<Notice text={ru?'Начальный баланс + операции = конечный баланс.':'Opening balance + transactions = closing balance.'}/>}
   {!draft.complete&&<Notice error text={ru?'Распознавание не подтвердило полноту выписки. Разделите большой PDF на части или загрузите более чёткий файл.':'Recognition did not confirm a complete statement. Split a large PDF or upload a clearer copy.'}/>}
   {canWrite&&<Button primary label={pending?(ru?'Повторить сохранение':'Retry save'):(ru?'Все строки проверены — сохранить выписку':'All rows reviewed — save statement')} disabled={busy||!canSave} onPress={()=>void action(async()=>{const command=pending??{id:randomUUID(),expected:selected.revision,data:current()};setPending(command);const d=await json(await authenticatedPost(`${path}/${selected.hash}/review`,command));if(alive.current){setPending(null);open(d);setNotice(ru?'Выписка сохранена в архиве этого счёта. Банковские суммы не продублированы.':'Statement saved to this account archive. Bank amounts were not duplicated.');}await reload();})}/>}
   {selected.data&&<Text style={styles.muted}>{ru?'Сохранено операций':'Saved transactions'}: {selected.data.rows.length} · {ru?'Итог движений':'Net movements'}: {exactUsd(selected.data.rows.reduce((n,r)=>n+BigInt(r.cents||'0'),0n),locale)}</Text>}
  </>}
 </Card>;
}
