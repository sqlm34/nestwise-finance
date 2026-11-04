export type OrderResult={received_cents:string;refunds_cents:string;purchased_parts_cents:string;stock_parts_cents:string};
export function parseOrderResult(value:unknown):OrderResult|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value))return undefined;
  const row=value as Record<string,unknown>;
  const keys=['received_cents','refunds_cents','purchased_parts_cents','stock_parts_cents'] as const;
  if(keys.some(key=>typeof row[key]!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(row[key] as string)))return undefined;
  return Object.fromEntries(keys.map(key=>[key,row[key]])) as OrderResult;
}
export function orderAfterParts(value:OrderResult):bigint {
  return BigInt(value.received_cents)-BigInt(value.refunds_cents)-BigInt(value.purchased_parts_cents)-BigInt(value.stock_parts_cents);
}
