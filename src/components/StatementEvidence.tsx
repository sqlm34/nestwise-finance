import React,{useEffect,useState} from 'react';
import {ActivityIndicator,Text,View} from 'react-native';
import {authenticatedFetch} from '../auth/client';
import {parseEvidenceReview,type EvidenceReview,type EvidenceStatus} from '../domain/statement-evidence';
import {insightMoney} from '../domain/period-insights';
import {useApp} from '../state';
import {Button,Notice,styles} from './ui';
export function StatementEvidence({workspace,account,hash,revision,onSessionExpired,onJournal}:{workspace:string;account:string;hash:string;revision:number;onSessionExpired:()=>void;onJournal:(id:string)=>void}){
  const {locale}=useApp(),ru=locale==='ru';
  const [reload,setReload]=useState(0),[result,setResult]=useState<{reload:number;revision:number;data:EvidenceReview|null}|null>(null);
  const [filter,setFilter]=useState<'all'|EvidenceStatus>('all'),[page,setPage]=useState(0);
  const labels={matched:ru?'Сопоставлено':'Matched',unmatched:ru?'Не сопоставлено':'Unmatched',blocked:ru?'Ошибка строки':'Row issue',mismatch:ru?'Расхождение с решением':'Evidence mismatch',reserved:ru?'Занято другой выпиской':'Claimed by another statement'};
  useEffect(()=>{
    const controller=new AbortController();let active=true;
    (async()=>{try{
      const response=await authenticatedFetch(`/v1/user/workspaces/${workspace}/accounts/${account}/documents/${hash}/review`,controller.signal);
      if(!active)return;if(response.status===401){onSessionExpired();return;}if(!response.ok)throw new Error();
      const data=parseEvidenceReview(await response.json(),hash);if(active)setResult({reload,revision,data});
    }catch{if(active)setResult({reload,revision,data:null});}})();
    return()=>{active=false;controller.abort();};
  },[workspace,account,hash,revision,reload,onSessionExpired]);
  const busy=result?.reload!==reload||result?.revision!==revision,data=busy?null:result?.data;
  const rows=data?.rows.filter(row=>filter==='all'||row.status===filter)??[],currentPage=Math.min(page,Math.max(0,Math.ceil(rows.length/25)-1));
  return <View style={{gap:12}}>
    <Text accessibilityRole="header" style={styles.h2}>{ru?'Проверка сверок по оригиналу':'Statement evidence review'}</Text>
    <Text selectable style={styles.muted}>SHA-256: {hash}</Text>
    <Notice text={ru?'Сопоставлено означает, что даты, суммы и описания строк совпали с сохранённым решением. Это не утверждённый отчёт бухгалтера. Отменённые решения не занимают строки.':'Matched means row dates, amounts and descriptions agree with the saved decision. This is not accountant approval. Canceled decisions do not reserve rows.'}/>
    <Button label={ru?'Обновить проверку':'Refresh evidence review'} disabled={busy} onPress={()=>setReload(value=>value+1)}/>
    {busy?<ActivityIndicator/>:!data?<Notice error text={ru?'Не удалось проверить оригинал. Доступность строк не подтверждена.':'Could not verify original. Row availability is unconfirmed.'}/>:<>
      <Text style={styles.muted}>{ru?'Проверено':'Checked'}: {new Date(data.checked_at).toLocaleString(locale)} · {data.copy==='primary'?(ru?'основная копия':'primary copy'):(ru?'резервная копия':'backup copy')} · {ru?'отменённых решений':'canceled decisions'}: {data.canceled}</Text>
      {(Object.keys(labels) as EvidenceStatus[]).map(status=><Text key={status} style={styles.text}>{labels[status]}: {data.totals[status].count} · +{insightMoney(BigInt(data.totals[status].credits),locale)} / −{insightMoney(BigInt(data.totals[status].debits),locale)}</Text>)}
      {data.groups.some(group=>!group.valid)&&<Notice error text={ru?'Есть решения, не совпадающие с оригиналом. Проверьте их в истории; исправление выполняется отменой и новой сверкой.':'Some decisions disagree with the original. Review history; correct them by cancellation and a new reconciliation.'}/>}
      <View style={styles.row}>{(['all',...Object.keys(labels)] as ('all'|EvidenceStatus)[]).map(value=><Button key={value} selected={filter===value} label={value==='all'?(ru?'Все строки':'All rows'):labels[value]} onPress={()=>{setFilter(value);setPage(0);}}/>)}</View>
      {!rows.length&&<Text style={styles.muted}>{ru?'Нет строк с этим статусом.':'No rows with this status.'}</Text>}
      {rows.slice(currentPage*25,currentPage*25+25).map(row=><View key={row.line} style={{gap:6,paddingVertical:8}}>
        <Text style={styles.text}>#{row.line} · {row.date} · {insightMoney(BigInt(row.cents),locale)} · {labels[row.status]}</Text>
        {row.groups.map(id=><Text key={id} selectable style={styles.muted}>{ru?'Решение':'Decision'}: {id}</Text>)}
        {Array.from(new Set(data.groups.filter(group=>row.groups.includes(group.id)).flatMap(group=>group.transactions))).map(id=><Button key={id} label={`${ru?'Детали проводки':'Journal details'} · ${id.slice(0,8)}`} onPress={()=>onJournal(id)}/>)}
      </View>)}
      <View style={styles.row}><Button label={ru?'Назад':'Previous'} disabled={currentPage===0} onPress={()=>setPage(currentPage-1)}/><Text>{currentPage+1} / {Math.max(1,Math.ceil(rows.length/25))}</Text><Button label={ru?'Далее':'Next'} disabled={(currentPage+1)*25>=rows.length} onPress={()=>setPage(currentPage+1)}/></View>
    </>}
  </View>;
}
