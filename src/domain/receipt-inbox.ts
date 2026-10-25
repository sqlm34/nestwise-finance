import type {ReceiptData} from './receipt';

export type InboxReceipt={hash:string;mime:string;archived:boolean;operation_id:string|null;review:{data:ReceiptData}|null};
export type ReceiptStage='upload'|'review'|'payment'|'posted';
export function receiptStage(row:InboxReceipt):ReceiptStage {
  if(row.operation_id)return 'posted';
  if(!row.archived)return 'upload';
  return row.review?'payment':'review';
}
export function receiptStageLabel(stage:ReceiptStage,ru:boolean){
  const labels={upload:['Upload incomplete','Загрузка не завершена'],review:['Needs review','Нужно проверить'],payment:['Reviewed · payment not recorded','Проверен · оплата не учтена'],posted:['Payment recorded','Оплата учтена']};
  return labels[stage][ru?1:0];
}
export function receiptTitle(row:InboxReceipt,ru:boolean){
  return row.review?.data.supplier.trim()||(row.mime==='application/pdf'?(ru?'Чек PDF':'PDF receipt'):(ru?'Фото чека':'Receipt image'));
}
export function receiptAmount(value:string|null|undefined){
  if(value==null)return '';
  const n=BigInt(value);return `${n/100n}.${(n%100n).toString().padStart(2,'0')} USD`;
}
export function receiptMatches(row:InboxReceipt,query:string,stage:ReceiptStage|'all'){
  if(stage!=='all'&&receiptStage(row)!==stage)return false;
  const data=row.review?.data;
  const text=[data?.supplier,data?.date,receiptAmount(data?.total_cents),...data?.items.map(i=>i.description)??[]].join(' ').toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word=>text.includes(word));
}
