const { Client } = require('pg');
const { createHash } = require('node:crypto');
async function fingerprint(client) {
  const tables=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='nestwise' ORDER BY tablename")).rows;
  const output={};
  for(const {tablename} of tables) {
    if(!/^[a-z_]+$/.test(tablename)) throw new Error('Unexpected identifier');
    const rows=(await client.query(`SELECT to_jsonb(t)::text row FROM nestwise.${tablename} t ORDER BY to_jsonb(t)::text`)).rows;
    output[tablename]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  return output;
}
(async()=>{
  const source=new Client({connectionString:process.env.TEST_DATABASE_URL});
  const restoredUrl=new URL(process.env.TEST_DATABASE_URL);
  if(!['localhost','127.0.0.1'].includes(restoredUrl.hostname)||restoredUrl.pathname!=='/nestwise_test') throw new Error('Restore verification must be local and disposable');
  restoredUrl.pathname='/nestwise_restore';
  const restored=new Client({connectionString:restoredUrl.href});
  try {
    await source.connect(); await restored.connect();
    const assert=require('node:assert/strict');
    assert.deepEqual(await fingerprint(restored),await fingerprint(source));
    await restored.query('SET ROLE nestwise_api');
    await assert.rejects(restored.query('SELECT * FROM nestwise.journal_entries'),/permission denied/);
    await restored.query('RESET ROLE');
    await assert.rejects(restored.query('DELETE FROM nestwise.journal_entries'),/immutable_financial_history/);
    console.log('Restore verified: every Nestwise table matches; privileges and immutable-history triggers preserved.');
  } finally {await source.end(); await restored.end();}
})().catch(()=>{console.error('Restore verification failed.');process.exitCode=1;});
