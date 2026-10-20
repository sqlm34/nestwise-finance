import { neon } from '@neondatabase/serverless';
import type {JournalFilters} from '../src/domain/journal-filters';
export type Database = {
  postBankRow(subject:string,workspace:string,account:string,id:string,hash:string,row:unknown,operation:unknown):Promise<string>;
  claimReceiptOcr(subject:string,workspace:string,account:string,hash:string):Promise<unknown>;
  prepareReceipt(subject:string,workspace:string,account:string,hash:string,bytes:number,mime:string):Promise<unknown>;
  completeReceipt(subject:string,workspace:string,account:string,hash:string):Promise<unknown>;
  reviewReceipt(subject:string,workspace:string,account:string,hash:string,id:string,expected:number,data:unknown):Promise<string>;
  postReceipt(subject:string,workspace:string,account:string,hash:string,review:string,operation:string,paid:string):Promise<string>;
  readReceipts(subject:string,workspace:string,account:string,hash:string|null,before?:string|null):Promise<unknown>;
  workspaceCommand(subject:string,workspace:string,payload:unknown):Promise<string>;
  workspaceAdministration(subject:string,workspace:string):Promise<unknown>;
  postManualOperation(subject:string,workspace:string,account:string,payload:unknown):Promise<string>;
  documentEvidence(subject:string,workspace:string,account:string,hash:string,fingerprints:string[]):Promise<unknown>;
  documentAccess(subject:string,workspace:string,account:string,write:boolean):Promise<unknown>;
  prepareDocument(subject:string,workspace:string,account:string,hash:string,bytes:number):Promise<unknown>;
  completeDocument(subject:string,workspace:string,account:string,hash:string):Promise<unknown>;
  readDocuments(subject:string,workspace:string,account:string):Promise<unknown>;
  readReconciliations(subject:string,workspace:string,account:string,cursor:string|null):Promise<unknown>;
  saveReconciliation(subject:string,workspace:string,account:string,payload:unknown):Promise<string>;
  cancelReconciliation(subject:string,workspace:string,account:string,id:string,reason:string):Promise<string>;
  userReconciliationCandidates(subject:string,workspace:string,account:string,from:string,to:string,cursor:string|null):Promise<unknown>;
  accept(connection: string, nonce: string, timestamp: number, raw: string): Promise<unknown>;
  journal(hash: string, workspace: string, account: string): Promise<unknown>;
  processPending(): Promise<void>;
  userAccess(subject: string): Promise<unknown>;
  userJournal(subject: string, workspace: string, account: string): Promise<unknown>;
  userJournalPage(subject:string,workspace:string,account:string,filters:JournalFilters,cursor:string|null):Promise<unknown>;
  userJournalDetail(subject:string,workspace:string,account:string,transaction:string,before:number|null):Promise<unknown>;
  userAccountEvents(subject:string,workspace:string,account:string,status:string,query:string,cursor:string|null):Promise<unknown>;
  userEventDetail(subject:string,workspace:string,account:string,event:string,before:number|null):Promise<unknown>;
  userPeriodInsights(subject:string,workspace:string,account:string,from:string,to:string):Promise<unknown>;
};
export function database(url: string): Database {
  const sql = neon(url);
  return {
    async postBankRow(subject,workspace,account,id,hash,row,operation){return (await sql`SELECT nestwise.post_bank_row(${subject},${workspace}::uuid,${account}::uuid,${id}::uuid,${hash},${JSON.stringify(row)}::jsonb,${JSON.stringify(operation)}::jsonb) result`)[0].result;},
    async claimReceiptOcr(subject,workspace,account,hash){return (await sql`SELECT nestwise.claim_receipt_ocr(${subject},${workspace}::uuid,${account}::uuid,${hash}) result`)[0].result;},
    async prepareReceipt(subject,workspace,account,hash,bytes,mime){return (await sql`SELECT nestwise.prepare_receipt(${subject},${workspace}::uuid,${account}::uuid,${hash},${bytes}::integer,${mime}) result`)[0].result;},
    async completeReceipt(subject,workspace,account,hash){return (await sql`SELECT nestwise.complete_receipt(${subject},${workspace}::uuid,${account}::uuid,${hash}) result`)[0].result;},
    async reviewReceipt(subject,workspace,account,hash,id,expected,data){return (await sql`SELECT nestwise.review_receipt(${subject},${workspace}::uuid,${account}::uuid,${hash},${id}::uuid,${expected}::integer,${JSON.stringify(data)}::jsonb) result`)[0].result;},
    async postReceipt(subject,workspace,account,hash,review,operation,paid){return (await sql`SELECT nestwise.post_receipt(${subject},${workspace}::uuid,${account}::uuid,${hash},${review}::uuid,${operation}::uuid,${paid}::date) result`)[0].result;},
    async readReceipts(subject,workspace,account,hash,before=null){return (await sql`SELECT nestwise.read_receipts(${subject},${workspace}::uuid,${account}::uuid,${hash},${before}) result`)[0].result;},
    async workspaceCommand(subject,workspace,payload){return (await sql`SELECT nestwise.workspace_command(${subject},${workspace}::uuid,${JSON.stringify(payload)}::jsonb) result`)[0].result;},
    async workspaceAdministration(subject,workspace){return (await sql`SELECT nestwise.workspace_administration(${subject},${workspace}::uuid) result`)[0].result;},
    async postManualOperation(subject,workspace,account,payload){return (await sql`SELECT nestwise.post_manual_operation(${subject},${workspace}::uuid,${account}::uuid,${JSON.stringify(payload)}::jsonb) result`)[0].result;},
    async documentEvidence(subject,workspace,account,hash,fingerprints){return (await sql`SELECT nestwise.document_evidence(${subject},${workspace}::uuid,${account}::uuid,${hash},${JSON.stringify(fingerprints)}::jsonb) result`)[0].result;},
    async documentAccess(subject,workspace,account,write){return (await sql`SELECT nestwise.document_access(${subject},${workspace}::uuid,${account}::uuid,${write}) result`)[0].result;},
    async prepareDocument(subject,workspace,account,hash,bytes){return (await sql`SELECT nestwise.prepare_document(${subject},${workspace}::uuid,${account}::uuid,${hash},${bytes}::integer) result`)[0].result;},
    async completeDocument(subject,workspace,account,hash){return (await sql`SELECT nestwise.complete_document(${subject},${workspace}::uuid,${account}::uuid,${hash}) result`)[0].result;},
    async readDocuments(subject,workspace,account){return (await sql`SELECT nestwise.read_documents(${subject},${workspace}::uuid,${account}::uuid) result`)[0].result;},
    async readReconciliations(subject,workspace,account,cursor){return (await sql`SELECT nestwise.read_reconciliations(${subject},${workspace}::uuid,${account}::uuid,${cursor}::uuid) result`)[0].result;},
    async saveReconciliation(subject,workspace,account,payload){return (await sql`SELECT nestwise.save_reconciliation(${subject},${workspace}::uuid,${account}::uuid,${JSON.stringify(payload)}::jsonb) result`)[0].result;},
    async cancelReconciliation(subject,workspace,account,id,reason){return (await sql`SELECT nestwise.cancel_reconciliation(${subject},${workspace}::uuid,${account}::uuid,${id}::uuid,${reason}) result`)[0].result;},
    async userReconciliationCandidates(subject,workspace,account,from,to,cursor) {
      return (await sql`SELECT nestwise.user_reconciliation_candidates(${subject},${workspace}::uuid,${account}::uuid,${from}::date,${to}::date,${cursor}::uuid) result`)[0].result;
    },
    async userPeriodInsights(subject,workspace,account,from,to) {
      return (await sql`SELECT nestwise.user_period_insights(${subject},${workspace}::uuid,${account}::uuid,${from}::date,${to}::date) result`)[0].result;
    },
    async userEventDetail(subject,workspace,account,event,before) {
      return (await sql`SELECT nestwise.user_event_detail(${subject},${workspace}::uuid,${account}::uuid,${event}::uuid,${before}::integer) result`)[0].result;
    },
    async userAccountEvents(subject,workspace,account,status,query,cursor) {
      return (await sql`SELECT nestwise.user_account_events(${subject},${workspace}::uuid,${account}::uuid,${status},${query},${cursor}::uuid) result`)[0].result;
    },
    async accept(connection, nonce, timestamp, raw) {
      const rows = await sql`SELECT nestwise.accept_event(${connection},${nonce}::uuid,${timestamp}::bigint,${raw}) result`;
      return rows[0].result;
    },
    async journal(hash, workspace, account) {
      const rows = await sql`SELECT nestwise.read_journal(${hash},${workspace}::uuid,${account}::uuid) result`;
      return rows[0].result;
    },
    async processPending() { await sql`SELECT nestwise.process_pending()`; },
    async userAccess(subject) {
      return (await sql`SELECT nestwise.user_access(${subject}) result`)[0].result;
    },
    async userJournal(subject, workspace, account) {
      return (await sql`SELECT nestwise.user_journal(${subject},${workspace}::uuid,${account}::uuid) result`)[0].result;
    },
    async userJournalPage(subject,workspace,account,filters,cursor) {
      return (await sql`SELECT nestwise.user_journal_page(${subject},${workspace}::uuid,${account}::uuid,
        ${filters.query},${filters.from||null}::date,${filters.to||null}::date,${filters.code},${filters.order},${cursor}::uuid) result`)[0].result;
    },
    async userJournalDetail(subject,workspace,account,transaction,before) {
      return (await sql`SELECT nestwise.user_journal_detail(${subject},${workspace}::uuid,${account}::uuid,
        ${transaction}::uuid,${before}::integer) result`)[0].result;
    },
  };
}
