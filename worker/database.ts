import { neon } from '@neondatabase/serverless';
export type Database = {
  accept(connection: string, nonce: string, timestamp: number, raw: string): Promise<unknown>;
  journal(hash: string, workspace: string, account: string): Promise<unknown>;
  processPending(): Promise<void>;
  userAccess(subject: string): Promise<unknown>;
  userJournal(subject: string, workspace: string, account: string): Promise<unknown>;
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
  };
}
