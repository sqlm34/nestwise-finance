import React,{useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import * as Crypto from 'expo-crypto';
import {authenticatedFetch,authenticatedUpload} from '../auth/client';
import {parseDocuments,type ArchivedDocument} from '../domain/documents';
import {previewStatement,type StatementPreview} from '../domain/statement';
import {useApp} from '../state';
import {Button,Card,Notice,styles} from './ui';
import {StatementEvidence} from './StatementEvidence';
import {insightMoney} from '../domain/period-insights';

export function StatementArchive({workspace,account,canWrite,file,onSessionExpired,onResume,onJournal,revision:evidenceRevision}:{workspace:string;account:string;canWrite:boolean;file:{hash:string;bytes:Uint8Array}|null;onSessionExpired:()=>void;onResume:(value:{hash:string;bytes:Uint8Array;preview:StatementPreview})=>void;onJournal:(id:string)=>void;revision:number}){
  const {locale}=useApp(),ru=locale==='ru';
  const [documents,setDocuments]=useState<ArchivedDocument[]|null>(null),[revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [opened,setOpened]=useState<{hash:string;bytes:Uint8Array;preview:StatementPreview}|null>(null),[page,setPage]=useState(0);
  const [reviewHash,setReviewHash]=useState<string|null>(null),[confirmResume,setConfirmResume]=useState(false);
  const mounted=useRef(true),lock=useRef(false);
  const base=`/v1/user/workspaces/${workspace}/accounts/${account}/documents`;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{try{const response=await authenticatedFetch(base,controller.signal);
      if(!active)return;if(response.status===401){onSessionExpired();return;}if(!response.ok)throw new Error();
      const data=parseDocuments(await response.json());if(active)setDocuments(data);
    }catch{if(active)setError(ru?'Архив недоступен. Обновите список.':'Archive unavailable. Refresh the list.');}})();
    return()=>{active=false;controller.abort();};
  },[base,revision,onSessionExpired,ru]);
  async function action(kind:'upload'|'open'|'verify',hash:string){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
    try{
      const response=kind==='upload'?await authenticatedUpload(`${base}/${hash}`,file!.bytes):await authenticatedFetch(`${base}/${hash}${kind==='verify'?'/verify':''}`);
      if(!mounted.current)return;if(response.status===401){onSessionExpired();return;}
      if(response.status===404)throw new Error(ru?'Файл недоступен или доступ отозван.':'File unavailable or access revoked.');
      if(response.status===409)throw new Error(ru?'Достигнут лимит 100 оригиналов на счёт.':'The account limit of 100 originals has been reached.');
      if(!response.ok)throw new Error(ru?'Операция не подтверждена. Обновите архив или повторите загрузку того же файла.':'Operation not confirmed. Refresh the archive or retry the same file.');
      if(kind==='open'){
        const bytes=new Uint8Array(await response.arrayBuffer());
        const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256,bytes);
        const actual=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        if(actual!==hash)throw new Error(ru?'Проверка целостности не пройдена.':'Integrity check failed.');
        const preview=previewStatement(new TextDecoder('utf-8',{fatal:true}).decode(bytes),'chase','Archive');
        if(!mounted.current)return;setOpened({hash,bytes,preview});setConfirmResume(false);setPage(0);
        setNotice(response.headers.get('X-Archive-Copy')==='backup'?(ru?'Основная копия недоступна. Открыта проверенная резервная копия.':'Primary unavailable. Opened verified backup.'):(ru?'Оригинал получен, SHA-256 совпадает.':'Original retrieved; SHA-256 matches.'));
      }else if(kind==='verify'){
        const result=await response.json();if(result.hash!==hash||typeof result.primary!=='boolean'||typeof result.backup!=='boolean')throw new Error();
        if(!mounted.current)return;setNotice(ru?`Целостность: основная копия — ${result.primary?'ОК':'недоступна'}, резервная — ${result.backup?'ОК':'недоступна'}.`:`Integrity: primary ${result.primary?'OK':'unavailable'}, backup ${result.backup?'OK':'unavailable'}.`);
      }else{
        const result=await response.json();if(result.hash!==hash||result.archived!==true)throw new Error();
        if(!mounted.current)return;setNotice(ru?'Оригинал сохранён в двух закрытых хранилищах.':'Original saved in two private stores.');setDocuments(null);setRevision(value=>value+1);
      }
    }catch(cause){if(mounted.current)setError(cause instanceof Error&&cause.message?cause.message:(ru?'Операция не подтверждена.':'Operation not confirmed.'));}
    finally{lock.current=false;if(mounted.current)setBusy(false);}
  }
  const saved=documents?.some(d=>d.hash===file?.hash&&d.archived);
  const visible=opened?.preview.rows.slice(page*25,(page+1)*25)??[];
  return <Card>
    <Text accessibilityRole="header" style={styles.h2}>{ru?'Приватный архив выписок':'Private statement archive'}</Text>
    <Notice text={ru?'Оригинал загружается только этой кнопкой. Доступ имеют пользователи с правом просмотра этого счёта. Две закрытые копии, до 2 МБ на CSV и 100 файлов на счёт. Загрузка не создаёт доходов или расходов.':'Originals upload only with this button. Users with access to this account can read them. Two private copies, up to 2 MB per CSV and 100 files per account. Uploading creates no income or expense.'}/>
    {file&&<Button primary label={saved?(ru?'Оригинал уже в архиве':'Original already archived'):(ru?'Сохранить оригинал в архив':'Archive original')} disabled={!canWrite||busy||saved} onPress={()=>void action('upload',file.hash)}/>}
    <Button label={ru?'Обновить архив':'Refresh archive'} disabled={busy} onPress={()=>{setError('');setRevision(value=>value+1);}}/>
    {busy&&<ActivityIndicator/>}{!!error&&<Notice error text={error}/>} {!!notice&&<Notice text={notice}/>}
    {!documents&&!error&&<ActivityIndicator/>}{documents?.length===0&&<Text style={styles.muted}>{ru?'Архив пока пуст.':'Archive is empty.'}</Text>}
    {documents?.map(doc=><View key={doc.hash} style={{gap:8,borderTopWidth:1,borderColor:'#dfe9e3',paddingTop:12}}>
      <Text style={styles.text}>{doc.archived?(ru?'Сохранён':'Archived'):(ru?'Загрузка не завершена — выберите тот же файл и повторите':'Upload pending — select the same file and retry')} · {doc.bytes} bytes · {new Date(doc.created_at).toLocaleString(locale)}</Text>
      <Text selectable style={styles.muted}>SHA-256: {doc.hash}</Text>
      <Text style={styles.muted}>{ru?'Связанных сверок, включая отменённые':'Linked reconciliations, including canceled'}: {doc.linked_groups}</Text>
      {doc.archived&&<View style={styles.row}><Button label={ru?'Открыть оригинал':'Open original'} disabled={busy} onPress={()=>void action('open',doc.hash)}/><Button label={ru?'Проверить обе копии':'Verify both copies'} disabled={busy} onPress={()=>void action('verify',doc.hash)}/><Button label={ru?'Проверить сверки':'Review evidence'} disabled={busy} onPress={()=>setReviewHash(doc.hash)}/></View>}
    </View>)}
    {reviewHash&&<StatementEvidence key={reviewHash} workspace={workspace} account={account} hash={reviewHash} revision={evidenceRevision} onSessionExpired={onSessionExpired} onJournal={onJournal}/>}
    {opened&&<View style={{gap:8}}>
      <Text accessibilityRole="header" style={styles.h2}>{ru?'Оригинал из архива':'Archived original'}</Text>
      <Text selectable style={styles.muted}>{opened.hash}</Text>
      {!confirmResume?<Button label={ru?'Продолжить сверку из архива':'Resume reconciliation from archive'} disabled={busy} onPress={()=>setConfirmResume(true)}/>:<>
        <Notice text={ru?'Текущий локальный файл и несохранённые черновики будут заменены. Сохранённая история останется.':'The current local file and unsaved drafts will be replaced. Saved history remains.'}/>
        <Button primary label={ru?'Открыть для сверки':'Open for reconciliation'} disabled={busy} onPress={()=>{onResume(opened);setConfirmResume(false);}}/>
        <Button label={ru?'Оставить текущий просмотр':'Keep current preview'} onPress={()=>setConfirmResume(false)}/>
      </>}
      {visible.map(row=><Text key={row.line} selectable style={styles.text}>#{row.line} · {row.date} · {row.description} · {insightMoney(BigInt(row.amountCents),locale)}</Text>)}
      <View style={styles.row}><Button label={ru?'Назад':'Previous'} disabled={page===0} onPress={()=>setPage(page-1)}/><Text>{page+1}</Text><Button label={ru?'Далее':'Next'} disabled={(page+1)*25>=opened.preview.rows.length} onPress={()=>setPage(page+1)}/><Button label={ru?'Закрыть оригинал':'Close original'} onPress={()=>setOpened(null)}/></View>
    </View>}
  </Card>;
}
