import type {JournalTransaction} from './journal';
export function transactionLabel(row:JournalTransaction,locale:'ru'|'en'):string {
  const sum=(code:string)=>row.entries.filter(e=>e.code===code).reduce((n,e)=>n+BigInt(e.cents),0n);
  const ru=locale==='ru',manual=row.source_order_id.startsWith('manual:');
  if(sum('refunds')>0n)return ru?'Возврат клиенту':'Refund to customer';
  if(sum('receipts')<0n)return manual?(ru?'Поступление':'Money received'):(ru?'Поступление от клиента':'Payment from customer');
  if(sum('parts_cost')>0n)return ru?'Покупка запчасти':'Parts purchase';
  if(sum('parts_cost')<0n)return ru?'Возврат за запчасть':'Parts refund';
  if(sum('fees')>0n)return ru?'Комиссия за оплату':'Payment fee';
  if(sum('fees')<0n)return ru?'Возврат комиссии':'Fee refund';
  if(sum('expenses')>0n)return ru?'Расход':'Expense';
  if(sum('expenses')<0n)return ru?'Возврат расхода':'Expense refund';
  if(row.entries.some(e=>e.code==='transfers'))return ru?'Перевод между счетами':'Transfer between accounts';
  return ru?'Корректировка':'Adjustment';
}
export function transactionPerson(row:JournalTransaction,locale:'ru'|'en'):string {
  return row.customer_name||(row.source_order_id.startsWith('manual:')?(locale==='ru'?'Добавлено вручную':'Added manually'):(locale==='ru'?'Клиент из CRM':'CRM customer'));
}
export function transactionAmount(row:JournalTransaction):bigint {
  const cash=row.entries.filter(e=>e.code==='clearing');
  return cash.length?cash.reduce((n,e)=>n+BigInt(e.cents),0n):-row.entries.filter(e=>e.code!=='parts_payable').reduce((n,e)=>n+BigInt(e.cents),0n);
}
