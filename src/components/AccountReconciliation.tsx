import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Text,TextInput,View} from 'react-native';
import {Button,Card,Notice,SearchField,styles} from './ui';
import {useApp,type PreviewFile} from '../state';
import {previewStatement} from '../domain/statement';
import {bankAmount,bankWindow,cashAmount,createDraft,eligibleBankRows,parseCandidates,reconciliationSample,suggestGroups,type Candidate,type DraftGroup} from '../domain/reconciliation';
import {insightMoney,type Period} from '../domain/period-insights';
import {readStatementFile} from '../statement-file';
import {authenticatedFetch} from '../auth/client';
import {messages,type MessageKey} from '../i18n';
import {JournalDetail} from './JournalDetail';
import {parseEvidenceReview,type EvidenceReview} from '../domain/statement-evidence';
import {StatementArchive} from './StatementArchive';
import {SaveDraftButton,SavedReconciliations} from './SavedReconciliations';

const kindLabels:Record<string,MessageKey>={'job.payment_recorded':'eventPayment','job.customer_refund_issued':'eventRefund','job.part_cost_recorded':'eventPart','job.supplier_credit_received':'eventCredit','job.processor_fee_recorded':'provenanceFee','job.processor_fee_refunded':'provenanceFeeRefund'};
export function AccountReconciliation({workspace,account,name,canWrite,onSessionExpired}:{workspace:string;account:string;name:string;canWrite:boolean;onSessionExpired:()=>void}){
  const {locale,t}=useApp(),ru=locale==='ru';
  const say=(en:string,ruText:string)=>ru?ruText:en;
  const [savedRevision,setSavedRevision]=useState(0),[savedLocal,setSavedLocal]=useState<string[]>([]);
  const [archiveHash,setArchiveHash]=useState<string|null>(null);
  const [archiveEvidence,setArchiveEvidence]=useState<{hash:string;revision:number;data:EvidenceReview|null}|null>(null);
  const [original,setOriginal]=useState<{hash:string;bytes:Uint8Array}|null>(null);
  const [file,setFile]=useState<PreviewFile|null>(null),[alias,setAlias]=useState('');
  const [loading,setLoading]=useState(false),[error,setError]=useState<MessageKey|null>(null);
  const [selected,setSelected]=useState<number[]>([]),[chosen,setChosen]=useState<string[]>([]);
  const [groups,setGroups]=useState<DraftGroup[]>([]),[search,setSearch]=useState(''),[page,setPage]=useState(0);
  const [request,setRequest]=useState<{period:Period;version:number}|null>(null);
  const [result,setResult]=useState<{request:typeof request;entries:Candidate[];truncated:boolean;error:boolean}|null>(null);
  const [detail,setDetail]=useState<string|null>(null),[candidatePage,setCandidatePage]=useState(0);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const busy=!!request&&result?.request!==request;
  const candidates=useMemo(()=>result?.request===request&&!result?.error&&!result?.truncated?result?.entries??[]:[],[result,request]);
  const rows=file?.preview.rows??[];
  const bank=useMemo(()=>(file?.preview.rows??[]).filter(row=>selected.includes(row.line)),[file,selected]);
  const eligible=useMemo(()=>eligibleBankRows(file?.preview.rows??[]),[file]);
  const evidenceReady=!archiveHash||archiveEvidence?.hash===archiveHash&&archiveEvidence.revision===savedRevision&&!!archiveEvidence.data;
  const lockedRows=archiveHash&&archiveEvidence?.hash===archiveHash?archiveEvidence.data?.rows.filter(row=>['matched','mismatch','reserved'].includes(row.status)).map(row=>row.line)??[]:[];
  const lockedIds=useMemo(()=>archiveHash&&archiveEvidence?.hash===archiveHash?archiveEvidence.data?.groups.flatMap(group=>group.transactions)??[]:[],[archiveHash,archiveEvidence]);
  const usedRows=new Set([...groups.flatMap(group=>group.rows),...lockedRows]),usedIds=new Set([...groups.flatMap(group=>group.transactions),...lockedIds]);
  const suggestions=useMemo(()=>suggestGroups(bank,candidates,new Set([...groups.flatMap(group=>group.transactions),...lockedIds])),[bank,candidates,groups,lockedIds]);
  const selectedJournal=candidates.filter(row=>chosen.includes(row.id));
  const difference=bankAmount(bank)-selectedJournal.reduce((sum,row)=>sum+cashAmount(row),0n);
  let draft:DraftGroup|null=null;
  try{if(evidenceReady)draft=createDraft(rows,selected,candidates,chosen,[...groups,{rows:lockedRows,transactions:lockedIds,cents:'0'}]);}catch{/* Incomplete or ambiguous selections stay unconfirmed. */}
  let period:Period|null=null;try{period=bankWindow(bank);}catch{/* Select at most 20 nearby rows. */}
  const resetSelection=()=>{setSelected([]);setChosen([]);setRequest(null);setResult(null);setCandidatePage(0);};
  async function load(sample:boolean){
    setLoading(true);setError(null);
    try{
      const loaded=await readStatementFile(sample?reconciliationSample:undefined);if(!loaded||!mounted.current)return;
      const preview=previewStatement(loaded.text,'chase',sample?'DEMO · 1234':alias);
      setArchiveHash(null);setArchiveEvidence(null);setOriginal({hash:loaded.hash,bytes:loaded.bytes});setFile({name:loaded.name,hash:loaded.hash,preview,sample});setGroups([]);setSavedLocal([]);resetSelection();setSearch('');setPage(0);
    }catch(cause){if(mounted.current){const message=cause instanceof Error?cause.message:'';setError(message in messages.en?message as MessageKey:'importError');}}
    finally{if(mounted.current)setLoading(false);}
  }
  useEffect(()=>{
    if(!request)return;
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const entries:Candidate[]=[],seen=new Set<string>();let cursor:string|null=null;
      for(let index=0;index<20;index++){
        const params=new URLSearchParams(request.period);if(cursor)params.set('cursor',cursor);
        const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/reconciliation-candidates?${params}`,controller.signal);
        if(!active)return;
        if(response.status===401){onSessionExpired();return;}
        if(!response.ok)throw new Error();
        const data=parseCandidates(await response.json(),request.period);
        for(const entry of data.entries){if(seen.has(entry.id))throw new Error();seen.add(entry.id);entries.push(entry);}
        cursor=data.next_cursor;
        if(!cursor)break;
      }
      if(active)setResult({request,entries,truncated:cursor!==null,error:false});
    }catch{if(active)setResult({request,entries:[],truncated:false,error:true});}})();
    return()=>{active=false;controller.abort();};
  },[request,workspace,account,onSessionExpired]);
  useEffect(()=>{
    if(!archiveHash)return;
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/documents/${archiveHash}/review`,controller.signal);
      if(!active)return;if(response.status===401){onSessionExpired();return;}if(!response.ok)throw new Error();
      const data=parseEvidenceReview(await response.json(),archiveHash);
      if(active){setArchiveEvidence({hash:archiveHash,revision:savedRevision,data});setSelected([]);setChosen([]);}
    }catch{if(active)setArchiveEvidence({hash:archiveHash,revision:savedRevision,data:null});}})();
    return()=>{active=false;controller.abort();};
  },[workspace,account,archiveHash,savedRevision,onSessionExpired]);
  if(detail)return <JournalDetail key={detail} workspace={workspace} account={account} name={name} transaction={detail} currency="USD" onSessionExpired={onSessionExpired} onClose={()=>setDetail(null)} onOpen={setDetail} backLabel="reconciliationBack"/>;
  const visible=rows.filter(row=>`${row.date} ${row.description}`.toLowerCase().includes(search.toLowerCase()));
  const maxPage=Math.max(0,Math.ceil(visible.length/25)-1),currentPage=Math.min(page,maxPage);
  return <>
    <Card>
      <Text accessibilityRole="header" style={styles.h2}>{say('Draft bank reconciliation','Черновая сверка с банком')}</Text>
      <Text style={styles.text}>{name} · USD</Text>
      <Notice text={say('Local drafts disappear when leaving this section. Save a group explicitly to retain its dates, amounts, hashes and journal links in account history. Originals stay on this device until you explicitly archive them below. No income or expense is created.','Локальные черновики исчезнут при выходе из раздела. Сохраните группу отдельно, чтобы записать даты, суммы, хеши и ссылки на проводки в историю счёта. Оригиналы остаются на устройстве, пока вы отдельно не сохраните их в архив ниже. Доходы и расходы не создаются.')}/>
      <Text style={styles.muted}>{say('UTF-8 CSV, up to 2 MB / 5,000 rows. Date, Description, Amount or Debit/Credit columns. Dates: YYYY-MM-DD or MM/DD/YYYY. PDF/OCR is not supported.','CSV UTF-8, до 2 МБ / 5 000 строк. Колонки Date, Description, Amount либо Debit/Credit. Даты: YYYY-MM-DD или MM/DD/YYYY. PDF/OCR пока не поддерживается.')}</Text>
      {!file?<>
        <TextInput accessibilityLabel={t('alias')} value={alias} onChangeText={setAlias} maxLength={60} style={styles.input} placeholder={t('aliasHint')}/>
        <View style={styles.row}><Button label={t('upload')} disabled={loading||!alias.trim()} onPress={()=>void load(false)}/><Button label={say('Load DEMO statement','Открыть DEMO-выписку')} disabled={loading} onPress={()=>void load(true)}/></View>
      </>:<>
        <Text style={styles.h2}>{file.name}</Text><Text style={styles.text}>{file.sample?'DEMO · ':''}{file.preview.accountAlias} · {rows.length} {t('rows')}</Text>
        <Text selectable style={styles.muted}>SHA-256: {file.hash}</Text>
        <Button label={say('Discard file and all drafts','Удалить файл из просмотра и все черновики')} onPress={()=>{setFile(null);setOriginal(null);setArchiveHash(null);setArchiveEvidence(null);setGroups([]);resetSelection();setError(null);}}/>
      </>}
      {loading&&<ActivityIndicator/>}{error&&<Notice error text={t(error)}/>}
    </Card>
    {file&&<>
      <Card>
        <Text style={styles.h2}>{say('1 · Select statement rows','1 · Выберите строки выписки')}</Text>
        <Notice text={say('Duplicates, ambiguous signs and invalid rows cannot be matched. Fix the source CSV and reload. Select up to 20 rows; grouped totals must not be zero.','Дубли, неоднозначные знаки и ошибочные строки нельзя сопоставить. Исправьте CSV и загрузите снова. Выберите до 20 строк; итог группы не должен быть нулевым.')}/>
        {file.preview.errors.length>0&&<Notice error text={`${t('reviewCount')}: ${file.preview.errors.length} · ${file.preview.errors.slice(0,10).map(row=>`${row.line}: ${t(row.code)}`).join('; ')}`}/>}
        <Text style={styles.text}>{say('Draft or saved / available / row issues','В черновиках или сохранено / доступно / ошибки строк')}: {usedRows.size} / {[...eligible].filter(line=>!usedRows.has(line)).length} / {rows.length-eligible.size}</Text>
        {archiveHash&&!evidenceReady&&<Notice text={say('Checking saved claims against the archived original. Selections stay blocked until verification succeeds.','Проверяем сохранённые решения по оригиналу. Выбор строк недоступен до успешной проверки.')}/>}
        {archiveHash&&<Button label={say('Refresh saved claims','Обновить занятые строки')} onPress={()=>setSavedRevision(value=>value+1)}/>}
        <SearchField value={search} onChange={value=>{setSearch(value);setPage(0);}} placeholder={say('Search statement rows','Поиск по выписке')}/>
        {visible.slice(currentPage*25,currentPage*25+25).map(row=><View key={row.line} style={{gap:6,paddingVertical:8}}>
          <Text style={styles.text}>#{row.line} · {row.date} · {row.description}</Text>
          <Button label={`${usedRows.has(row.line)?say('Draft linked','В черновике'):!eligible.has(row.line)?say('Review required','Нужна проверка'):selected.includes(row.line)?say('Deselect','Снять выбор'):say('Select','Выбрать')} #${row.line} · ${insightMoney(BigInt(row.amountCents),locale)}`}
            selected={selected.includes(row.line)} disabled={!evidenceReady||!eligible.has(row.line)||usedRows.has(row.line)||!selected.includes(row.line)&&selected.length>=20}
            onPress={()=>{setSelected(current=>current.includes(row.line)?current.filter(id=>id!==row.line):[...current,row.line]);setChosen([]);setRequest(null);setResult(null);setCandidatePage(0);}}/>
        </View>)}
        <View style={styles.row}><Button label={t('previous')} disabled={currentPage===0} onPress={()=>setPage(currentPage-1)}/><Text>{currentPage+1} / {maxPage+1}</Text><Button label={t('next')} disabled={currentPage===maxPage} onPress={()=>setPage(currentPage+1)}/></View>
        <Text style={styles.h2}>{say('Selected bank total','Сумма выбранных строк')}: {insightMoney(bankAmount(bank),locale)}</Text>
        {period&&<Text style={styles.muted}>{period.from} → {period.to} UTC</Text>}
        <Button primary label={say('Find paid journal candidates','Найти оплаченные проводки')} disabled={!period||bankAmount(bank)===0n||busy} onPress={()=>{if(period){setChosen([]);setCandidatePage(0);setRequest(current=>({period,version:(current?.version??0)+1}));}}}/>
      </Card>
      {request&&<Card>
        <Text style={styles.h2}>{say('2 · Review journal candidates','2 · Проверьте проводки')}</Text>
        <Notice text={say('Payment dates in UTC within 7 days of a selected bank row. Cost corrections, accruals, missing payment dates and unresolved events are excluded. Amount/date suggestions are not proof of settlement; verify the source order and bank evidence.','Даты оплаты в UTC в пределах 7 дней от выбранной строки. Корректировки стоимости, начисления, записи без даты оплаты и нерешённые события исключены. Совпадение суммы и даты не доказывает расчёт: проверьте заказ и банковские документы.')}/>
        {busy?<ActivityIndicator/>:result?.error?<Notice error text={t('journalUnavailable')}/>:result?.truncated?<Notice error text={say('More than 2,000 candidates. Narrow the bank-row selection before matching.','Больше 2 000 проводок. Сузьте выбор строк выписки перед сопоставлением.')}/>:<>
          <Text style={styles.text}>{say('Candidates','Проводки')}: {candidates.length}</Text>
          {suggestions.limited&&<Notice text={say('Suggestions are limited to 60 candidates, groups of up to 3 and 10 results. You can manually select up to 20 transactions.','Подсказки ограничены 60 проводками, группами до 3 и 10 результатами. Вручную можно выбрать до 20 проводок.')}/>}
          {suggestions.groups.map((ids,index)=><Button key={ids.join(':')} label={`${say('Review suggestion','Проверить вариант')} ${index+1} · ${ids.length} ${say('transactions','проводок')}`} onPress={()=>setChosen(ids)}/>)}
          {!suggestions.groups.length&&<Text style={styles.muted}>{say('No exact suggestion. Review manually; a difference cannot be confirmed.','Точной подсказки нет. Проверьте вручную; группу с расхождением нельзя подтвердить.')}</Text>}
          {candidates.slice(candidatePage*25,candidatePage*25+25).map(row=><View key={row.id} style={{gap:6,paddingVertical:8}}>
            <Text style={styles.text}>{row.source_order_id} · {new Date(row.paid_at!).toISOString().slice(0,10)} · {t(kindLabels[row.kind])}</Text>
            <Text selectable style={styles.muted}>{row.id}</Text>
            <View style={styles.row}><Button label={`${chosen.includes(row.id)?say('Deselect','Снять выбор'):say('Select transaction','Выбрать проводку')} · ${insightMoney(cashAmount(row),locale)}`} selected={chosen.includes(row.id)} disabled={usedIds.has(row.id)||!chosen.includes(row.id)&&chosen.length>=20} onPress={()=>setChosen(current=>current.includes(row.id)?current.filter(id=>id!==row.id):[...current,row.id])}/><Button label={t('provenanceTitle')} onPress={()=>setDetail(row.id)}/></View>
          </View>)}
          <View style={styles.row}><Button label={t('previous')} disabled={!candidatePage} onPress={()=>setCandidatePage(current=>current-1)}/><Text>{candidatePage+1} / {Math.max(1,Math.ceil(candidates.length/25))}</Text><Button label={t('next')} disabled={(candidatePage+1)*25>=candidates.length} onPress={()=>setCandidatePage(current=>current+1)}/></View>
          <Text style={styles.h2}>{say('Difference','Расхождение')}: {insightMoney(difference,locale)}</Text>
          <Text style={styles.muted}>{say('Confirm only after reviewing the evidence. This marks a local draft, not an approved bank reconciliation.','Подтверждайте после проверки документов. Это отметка локального черновика, а не утверждённая банковская сверка.')}</Text>
          <Button primary label={say('Confirm draft group','Подтвердить группу в черновике')} disabled={!draft} onPress={()=>{if(draft){setGroups(current=>[...current,draft]);resetSelection();}}}/>
        </>}
      </Card>}
      <Card><Text style={styles.h2}>{say('3 · Draft groups','3 · Группы черновика')} · {groups.length}</Text>
        {groups.map((group,index)=><View key={group.rows.join(':')} style={{gap:8}}><Text style={styles.text}>#{index+1} · {insightMoney(BigInt(group.cents),locale)} · {say('Bank rows','Строки банка')}: {group.rows.join(', ')} · {group.transactions.length} {say('journal transactions','проводок')}</Text>{group.transactions.map(id=><Button key={id} label={`${t('provenanceOpen')} · ${id.slice(0,8)}`} onPress={()=>setDetail(id)}/>)}<SaveDraftButton workspace={workspace} account={account} file={file} group={group} alreadySaved={savedLocal.includes(group.rows.join(':'))} canWrite={canWrite} onSessionExpired={onSessionExpired} onSaved={()=>{setSavedLocal(current=>[...current,group.rows.join(':')]);setSavedRevision(current=>current+1);}}/><Button disabled={savedLocal.includes(group.rows.join(':'))} label={`${say('Undo group','Отменить группу')} ${index+1}`} onPress={()=>{setGroups(current=>current.filter(item=>item!==group));resetSelection();}}/></View>)}
        {!groups.length&&<Text style={styles.muted}>{say('No draft decisions yet. Unmatched rows remain unresolved.','Пока нет решений. Несопоставленные строки остаются нерешёнными.')}</Text>}
      </Card>
    </>}
    <StatementArchive workspace={workspace} account={account} canWrite={canWrite} file={file?original:null} onSessionExpired={onSessionExpired} revision={savedRevision} onJournal={setDetail} onResume={loaded=>{
      setFile({name:`archive-${loaded.hash.slice(0,12)}.csv`,hash:loaded.hash,preview:loaded.preview,sample:false});setOriginal({hash:loaded.hash,bytes:loaded.bytes});setArchiveHash(loaded.hash);setArchiveEvidence(null);setGroups([]);setSavedLocal([]);resetSelection();setSearch('');setPage(0);setSavedRevision(value=>value+1);
    }}/>
    <SavedReconciliations workspace={workspace} account={account} revision={savedRevision} onSessionExpired={onSessionExpired} onOpen={setDetail} onChanged={canceled=>{if(file?.hash===canceled.file_hash){const key=canceled.rows.map(row=>row.line).join(':');setGroups(current=>current.filter(group=>group.rows.join(':')!==key));setSavedLocal(current=>current.filter(value=>value!==key));resetSelection();}setSavedRevision(current=>current+1);}}/>
  </>;
}
