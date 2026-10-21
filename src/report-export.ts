import {Platform} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {File,Paths} from 'expo-file-system';
import {randomUUID} from 'expo-crypto';
import {reportHTML,reportCSV,type Report} from './domain/accountant-report';
export async function exportReport(report:Report,format:'pdf'|'csv'){
 if(!report.id)throw new Error('snapshot_required');
 if(Platform.OS==='web'){
  if(format==='csv'){
   const url=URL.createObjectURL(new Blob([reportCSV(report)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`nestwise-${report.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60_000);return;
  }
  // A separate print document prevents printing navigation or unrelated account data.
  const frame=document.createElement('iframe');frame.style.position='fixed';frame.style.width='0';frame.style.height='0';frame.style.border='0';frame.title='Financial Statement';
  frame.onload=()=>{frame.contentWindow?.focus();frame.contentWindow?.print();setTimeout(()=>frame.remove(),60_000);};frame.srcdoc=reportHTML(report);document.body.appendChild(frame);return;
 }
 if(!await Sharing.isAvailableAsync())throw new Error('sharing_unavailable');
 let file:File|undefined;
 try{
  if(format==='pdf'){const result=await Print.printToFileAsync({html:reportHTML(report),width:612,height:792});file=new File(result.uri);}
  else{file=new File(Paths.cache,`nestwise-${randomUUID()}.csv`);file.create();file.write(reportCSV(report));}
  await Sharing.shareAsync(file.uri,{mimeType:format==='pdf'?'application/pdf':'text/csv',UTI:format==='pdf'?'.pdf':'.csv'});
 }finally{if(file?.exists)try{file.delete();}catch{/* Only this export cache file. */}}
}
