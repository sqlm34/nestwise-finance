import { neon } from '@neondatabase/serverless';
import type {JournalFilters} from '../src/domain/journal-filters';
export type Database = {
  accept(connection: string, nonce: string, timestamp: number, raw: string): Promise<unknown>;
  journal(hash: string, workspace: string, account: string): Promise<unknown>;
  processPending(): Promise<void>;
  userAccess(subject: string): Promise<unknown>;
  userJournal(subject: string, workspace: string, account: string): Promise<unknown>;
  userJournalPage(subject:string,workspace:string,account:string,filters:JournalFilters,cursor:string|null):Promise<unknown>;
};
export function database(url: string): Database {
  const sql = neon(url);
  return {
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
  };
}
