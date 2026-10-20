import {parseJournal,type JournalTransaction} from './journal';
import {parseReceipt,type ReceiptData} from './receipt';
/** Non-CRM input contract. Validation does not authorize or post a transaction. */
export type Allocation = {category: string; cents: string};
export type ManualOperation = {
  id: string;
  kind: 'income' | 'expense' | 'transfer' | 'refund';
  paid_on: string;
  amount_cents: string;
  note: string;
  destination_account: string | null;
  reference_operation: string | null;
  allocations: Allocation[];
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields = ['id', 'kind', 'paid_on', 'amount_cents', 'note', 'destination_account', 'reference_operation', 'allocations'];
function fail(): never { throw new Error('invalid_manual_operation'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function identity(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) return fail();
  return value.toLowerCase();
}
function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || BigInt(value) > 9007199254740991n) return fail();
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value || value < '1900-01-01' || value > '2199-12-31') return fail();
  return value;
}
export function parseManualOperation(value: unknown): ManualOperation {
  const row = object(value);
  if (Object.keys(row).length !== fields.length || fields.some(key => !Object.hasOwn(row, key))) return fail();
  if (!['income', 'expense', 'transfer', 'refund'].includes(row.kind as string)) return fail();
  const kind = row.kind as ManualOperation['kind'];
  if (typeof row.note !== 'string' || row.note.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.note)) return fail();
  const destination = row.destination_account === null ? null : identity(row.destination_account);
  const reference = row.reference_operation === null ? null : identity(row.reference_operation);
  if ((kind === 'transfer') !== (destination !== null) || (kind === 'refund') !== (reference !== null)) return fail();
  if (!Array.isArray(row.allocations) || row.allocations.length > 50) return fail();
  const allocations = row.allocations.map(raw => {
    const split = object(raw);
    if (Object.keys(split).length !== 2 || typeof split.category !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(split.category)) return fail();
    return {category: split.category, cents: amount(split.cents)};
  }).sort((a, b) => a.category < b.category ? -1 : a.category > b.category ? 1 : 0);
  const total = amount(row.amount_cents);
  if (kind === 'income' || kind === 'expense') {
    if (!allocations.length || new Set(allocations.map(a => a.category)).size !== allocations.length
      || allocations.reduce((sum, a) => sum + BigInt(a.cents), 0n) !== BigInt(total)) return fail();
  } else if (allocations.length) return fail(); // Refund allocation comes from its original posting.
  const id = identity(row.id);
  if (reference === id) return fail();
  return {id, kind, paid_on: date(row.paid_on), amount_cents: total, note: row.note.trim(),
    destination_account: destination, reference_operation: reference, allocations};
}

/** Stable bytes for idempotency comparison. Server must also bind actor/account. */
export function canonicalManualOperation(value: unknown): string {
  return JSON.stringify(parseManualOperation(value));
}
export type ManualDetail={manual:ManualOperation;transaction:JournalTransaction;actor:string;created_at:string;refunded_cents:string;receipt:{hash:string;review_id:string;revision:number;data:ReceiptData}|null};
export function parseManualDetail(value:unknown,expected:string):ManualDetail{
  const row=object(value),manual=parseManualOperation(row.manual);
  const transaction=parseJournal({entries:[row.transaction],limit:100}).entries[0];
  if(transaction.id!==expected||transaction.source_event_id!==manual.id||transaction.source_order_id!==`manual:${manual.id}`
    ||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at))||typeof row.refunded_cents!=='string'
    ||!/^(0|[1-9]\d{0,15})$/.test(row.refunded_cents)||BigInt(row.refunded_cents)>BigInt(manual.amount_cents))return fail();
  let receipt:ManualDetail['receipt']=null;
  if(row.receipt!=null){const r=object(row.receipt);
    if(typeof r.hash!=='string'||!/^[a-f0-9]{64}$/.test(r.hash)||!Number.isSafeInteger(r.revision)||Number(r.revision)<1)return fail();
    const data=parseReceipt(r.data,true);if(manual.kind!=='expense'||data.total_cents!==manual.amount_cents)return fail();
    receipt={hash:r.hash,review_id:identity(r.review_id),revision:Number(r.revision),data};
  }
  return {manual,transaction,actor:identity(row.actor),created_at:row.created_at,refunded_cents:row.refunded_cents,receipt};
}
