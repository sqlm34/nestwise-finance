import {neon} from '@neondatabase/serverless';
export type BankEnv={NESTWISE_DATABASE_URL?:string;PLAID_PERSONAL_CONNECTIONS?:string;PLAID_CLIENT_ID?:string;PLAID_SECRET?:string;PLAID_ENVIRONMENT?:string};
type Connection={feed:string;access_token:string;account_id:string};
type Transaction={transaction_id:string;account_id:string;date:string;name:string;merchant_name?:string|null;amount:number;pending:boolean;iso_currency_code:string;personal_finance_category?:{primary?:string}|null};
type SyncPage={added:Transaction[];modified:Transaction[];removed:{transaction_id:string}[];next_cursor:string;has_more:boolean};
export async function requestBankPage(env:BankEnv,connection:Connection,cursor:string,fetcher:typeof fetch=(input,init)=>globalThis.fetch(input,init)):Promise<SyncPage>{
 const result=await fetcher(`https://${env.PLAID_ENVIRONMENT}.plaid.com/transactions/sync`,{method:'POST',redirect:'manual',
  headers:{'Content-Type':'application/json','Plaid-Version':'2020-09-14'},signal:AbortSignal.timeout(25_000),
  body:JSON.stringify({client_id:env.PLAID_CLIENT_ID,secret:env.PLAID_SECRET,access_token:connection.access_token,cursor,count:500})});
 if(result.status>=300&&result.status<400){await result.body?.cancel();throw Error('bank_feed_redirect');}
 const body=await result.json() as SyncPage&{error_code?:string};
 if(!result.ok)throw Error(body.error_code==='ITEM_LOGIN_REQUIRED'||body.error_code==='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'?body.error_code:'bank_feed_unavailable');
 return body;
}
export type BankRow={id:string;paid_on:string;name:string;cents:string;pending:boolean;category:string;currency:string};
export function bankRow(t:Transaction):BankRow {
 if(!t.transaction_id||!/^\d{4}-\d{2}-\d{2}$/.test(t.date)||t.iso_currency_code!=='USD'||!Number.isFinite(t.amount))throw Error('invalid_bank_feed');
 const cents=Math.round(t.amount*100);
 if(!Number.isSafeInteger(cents)||Math.abs(t.amount*100-cents)>0.001)throw Error('invalid_bank_feed');
 // Plaid positive amounts are outflows; Nestwise signed amounts are inflows.
 return {id:t.transaction_id,paid_on:t.date,name:(t.merchant_name||t.name).slice(0,300),cents:String(-cents),pending:t.pending,
  category:t.personal_finance_category?.primary||'OTHER',currency:'USD'};
}
export async function collectBankChanges(cursor:string,account:string,call:(cursor:string)=>Promise<SyncPage>){
 // A pagination mutation invalidates the entire batch, never a committed partial page.
 for(let attempt=0;attempt<3;attempt++){
  let next=cursor;const rows=new Map<string,BankRow>(),removed=new Set<string>();
  try{
   for(let page=0;page<100;page++){
    const result=await call(next);
    for(const t of result.removed){rows.delete(t.transaction_id);removed.add(t.transaction_id);}
    for(const t of [...result.added,...result.modified]){
     if(t.account_id!==account)continue;
     removed.delete(t.transaction_id);rows.set(t.transaction_id,bankRow(t));
    }
    if(typeof result.next_cursor!=='string'||typeof result.has_more!=='boolean')throw Error('invalid_bank_feed');
    next=result.next_cursor;
    if(!result.has_more)return {cursor:next,rows:[...rows.values()],removed:[...removed]};
   }
   throw Error('bank_feed_page_limit');
  }catch(error){if(!(error instanceof Error)||error.message!=='TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION'||attempt===2)throw error;}
 }
 throw Error('bank_feed_unavailable');
}
export async function syncPersonalBanks(env:BankEnv){
 if(!env.PLAID_PERSONAL_CONNECTIONS||!env.PLAID_CLIENT_ID||!env.PLAID_SECRET||!env.NESTWISE_DATABASE_URL)return;
 if(!['production','sandbox'].includes(env.PLAID_ENVIRONMENT||''))throw Error('bank_configuration');
 const connections:Connection[]=JSON.parse(env.PLAID_PERSONAL_CONNECTIONS);
 if(!Array.isArray(connections)||connections.length>10)throw Error('bank_configuration');
 const sql=neon(env.NESTWISE_DATABASE_URL);
 for(const connection of connections){
  if(!/^[0-9a-f-]{36}$/i.test(connection.feed)||!connection.access_token||!connection.account_id)throw Error('bank_configuration');
  const lease=crypto.randomUUID();
  const claim=(await sql`SELECT nestwise.claim_bank_feed(${connection.feed}::uuid,${lease}::uuid) result`)[0].result;
  if(!claim)continue;
  try{
   const changes=await collectBankChanges(claim.cursor,connection.account_id,cursor=>requestBankPage(env,connection,cursor));
   await sql`SELECT nestwise.apply_bank_feed(${connection.feed}::uuid,${lease}::uuid,${claim.cursor},${changes.cursor},${JSON.stringify(changes.rows)}::jsonb,${JSON.stringify(changes.removed)}::jsonb,NULL)`;
  }catch(error){
   const code=error instanceof Error&&error.message==='ITEM_LOGIN_REQUIRED'?'ITEM_LOGIN_REQUIRED':'bank_feed_unavailable';
   await sql`SELECT nestwise.apply_bank_feed(${connection.feed}::uuid,${lease}::uuid,${claim.cursor},NULL,'[]'::jsonb,'[]'::jsonb,${code})`;
  }
 }
}
