import { neon } from '@neondatabase/serverless';
import type {JournalFilters} from '../src/domain/journal-filters';
export type Database = {
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
