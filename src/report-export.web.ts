import {reportHTML,reportCSV,type Report} from './domain/accountant-report';
/** Web-only implementation: in-app browsers may silently suppress popup windows. */
export async function exportReport(report:Report,format:'pdf'|'csv'|'html'){
 if(!report.id)throw new Error('snapshot_required');
 if(format==='csv'||format==='html'){
  const url=URL.createObjectURL(new Blob([format==='csv'?reportCSV(report):reportHTML(report)],{type:format==='csv'?'text/csv;charset=utf-8':'text/html;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`nestwise-${report.id}.${format}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60_000);return;
 }
 // Render only the immutable report. Printing starts on a separate explicit click,
 // not from an invisible frame; Reload returns to the authenticated app route.
 const html=reportHTML(report).replace('<body>','<body><nav class="print-controls" style="padding:16px;font:16px Arial"><button onclick="window.print()">Print / Save PDF · Печать / Сохранить PDF</button> <button onclick="window.location.reload()">Back to Nestwise · Вернуться в Nestwise</button><p>Choose Save as PDF in the print dialog. / Выберите сохранение в PDF в диалоге печати.</p></nav><style>@media print{.print-controls{display:none}}</style>');
 document.open();document.write(html);document.close();
}
