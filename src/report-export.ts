import {Platform} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {File,Paths} from 'expo-file-system';
import {randomUUID} from 'expo-crypto';
import {reportHTML,reportCSV,type Report} from './domain/accountant-report';
export async function exportReport(report:Report,format:'pdf'|'csv'|'html'){
 if(!report.id)throw new Error('snapshot_required');
 if(Platform.OS==='web'){
  if(format==='csv'||format==='html'){
   const url=URL.createObjectURL(new Blob([format==='csv'?reportCSV(report):reportHTML(report)],{type:format==='csv'?'text/csv;charset=utf-8':'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`nestwise-${report.id}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60_000);return;
  }
  // The user starts printing in a separate document. Never invoke a blocking
  // system print dialog from a hidden frame in the accounting application.
  const page=window.open('about:blank','_blank');
  if(!page)throw new Error('print_popup_blocked');
  page.opener=null;
  page.document.open();
  page.document.write(reportHTML(report).replace('<body>','<body><nav class="print-controls" style="padding:16px"><button onclick="window.print()">Print / Save PDF · Печать / Сохранить PDF</button><p>Choose Save as PDF in the print dialog. / Выберите сохранение в PDF в диалоге печати.</p></nav><style>@media print{.print-controls{display:none}}</style>'));
  page.document.close();return;
 }
 if(!await Sharing.isAvailableAsync())throw new Error('sharing_unavailable');
 let file:File|undefined;
 try{
  if(format==='html')throw new Error('web_only');
  if(format==='pdf'){const result=await Print.printToFileAsync({html:reportHTML(report),width:612,height:792});file=new File(result.uri);}
  else{file=new File(Paths.cache,`nestwise-${randomUUID()}.csv`);file.create();file.write(reportCSV(report));}
  await Sharing.shareAsync(file.uri,{mimeType:format==='pdf'?'application/pdf':'text/csv',UTI:format==='pdf'?'.pdf':'.csv'});
 }finally{if(file?.exists)try{file.delete();}catch{/* Only this export cache file. */}}
}
