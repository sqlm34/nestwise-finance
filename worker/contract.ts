export const eventTypes = [
  'job.payment_recorded', 'job.part_cost_recorded', 'job.customer_refund_issued',
  'job.supplier_credit_received', 'job.cost_corrected', 'job.processor_fee_recorded',
  'job.processor_fee_refunded', 'job.financials_finalized', 'job.reopened', 'job.voided',
] as const;
export type CrmEvent = {
  schema_version: 1; source_event_id: string; source_order_id: string;
  source_fact_id: string; order_revision: number; type: typeof eventTypes[number];
  currency: 'USD'; occurred_at: string; paid_at: string | null;
  amount_cents?: number; reference_event_id?: string; settlement?: 'paid' | 'accrued';
  totals?: { payments_cents: number; refunds_cents: number; parts_net_cents: number; fees_net_cents: number };
};
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const utcDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value.replace(/(?<!\.\d{3})Z$/, '.000Z');
};
const minorUnits = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function validateEvent(value: unknown): CrmEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_contract');
  const e = value as Record<string, unknown>;
  const required = ['schema_version', 'source_event_id', 'source_order_id', 'source_fact_id',
    'order_revision', 'type', 'currency', 'occurred_at', 'paid_at'];
  if (required.some(k => !(k in e)) || e.schema_version !== 1 || e.currency !== 'USD'
    || typeof e.source_event_id !== 'string' || !uuid.test(e.source_event_id)
    || !['source_order_id', 'source_fact_id'].every(k => typeof e[k] === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(e[k]))
    || !Number.isInteger(e.order_revision) || Number(e.order_revision) < 1 || Number(e.order_revision) > 2147483646
    || !eventTypes.includes(e.type as CrmEvent['type']) || !utcDate(e.occurred_at)
    || (e.paid_at !== null && !utcDate(e.paid_at))) throw new Error('invalid_contract');
  const assertion = ['job.financials_finalized', 'job.reopened', 'job.voided'].includes(e.type as string);
  const referenced = ['job.customer_refund_issued', 'job.supplier_credit_received', 'job.cost_corrected', 'job.processor_fee_refunded'].includes(e.type as string);
  const allowed = [...required];
  if (!assertion) {
    allowed.push('amount_cents');
    if (!minorUnits(e.amount_cents) || (e.amount_cents === 0 && e.type !== 'job.cost_corrected')) throw new Error('invalid_amount');
    if (e.type === 'job.part_cost_recorded') {
      allowed.push('settlement');
      if (e.settlement !== 'paid' && e.settlement !== 'accrued') throw new Error('invalid_contract');
      if (e.settlement === 'accrued' && e.paid_at !== null) throw new Error('invalid_contract');
    }
    if (!['job.cost_corrected','job.supplier_credit_received'].includes(e.type as string)
      && e.settlement !== 'accrued' && e.paid_at === null) throw new Error('missing_paid_at');
  } else if (e.paid_at !== null) throw new Error('invalid_contract');
  if (referenced) {
    allowed.push('reference_event_id');
    if (typeof e.reference_event_id !== 'string' || !uuid.test(e.reference_event_id)) throw new Error('invalid_reference');
  }
  if (e.type === 'job.financials_finalized') {
    allowed.push('totals');
    if (!e.totals || typeof e.totals !== 'object' || Array.isArray(e.totals)) throw new Error('invalid_snapshot');
    const totals = e.totals as Record<string, unknown>;
    const fields = ['payments_cents', 'refunds_cents', 'parts_net_cents', 'fees_net_cents'];
    if (Object.keys(totals).length !== 4 || !fields.every(k => minorUnits(totals[k]))) throw new Error('invalid_snapshot');
  }
  if (Object.keys(e).some(k => !allowed.includes(k))) throw new Error('unexpected_field');
  return value as CrmEvent;
}
