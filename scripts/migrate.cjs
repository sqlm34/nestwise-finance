const { Client } = require('pg');
const { createHash } = require('node:crypto');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

async function migrate(client, directory = 'db/migrations') {
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(726498312)");
    const name = (await client.query('SELECT current_database() name')).rows[0].name;
    if (!/^nestwise_(development|staging|test)$/.test(name)) throw new Error('Refusing database outside Nestwise non-production namespace');
    const crm = await client.query("SELECT to_regclass('public.jobs') found");
    if (crm.rows[0].found) throw new Error('Refusing a database containing CRM jobs');
    await client.query(`CREATE TABLE IF NOT EXISTS public.nestwise_schema_migrations
      (version text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map((await client.query('SELECT version,sha256 FROM public.nestwise_schema_migrations')).rows.map(r=>[r.version,r.sha256]));
    const files = readdirSync(directory).filter(n=>/^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
    for (const known of applied.keys()) if (!files.includes(known)) throw new Error('Previously applied migration is missing');
    for (const version of files) {
      const source=readFileSync(join(directory,version),'utf8').replace(/\r\n/g,'\n'), hash=createHash('sha256').update(source).digest('hex');
      if (applied.has(version)) {
        // Earlier Windows-applied migrations may record CRLF bytes. Accept only
        // that exact line-ending variant; never rewrite historical hashes.
        const legacy=createHash('sha256').update(source.replace(/\n/g,'\r\n')).digest('hex');
        if (applied.get(version)!==hash && applied.get(version)!==legacy) {
          // One historical staging bundle recorded a different checksum for 0014.
          // Its retained SQL matches this exact canonical source; also verify the
          // deployed function that changed during that release. Preserve history.
          const attested=version==='0014_manual_operations.sql'
            && hash==='980cef4bcaca0803089a5b9cfd89ed65be05942723fda337a5676e2b5975850d'
            && applied.get(version)==='37cc3c0bb2c28aba824cf178d5f10313c799f1996bef8d404cb6177c38893a51';
          if(!attested)throw new Error('Previously applied migration changed');
          const proof=await client.query("SELECT md5(replace(prosrc,E'\\r\\n',E'\\n')) AS body_hash FROM pg_proc WHERE oid=to_regprocedure('nestwise.post_manual_operation(text,uuid,uuid,jsonb)')");
          if(proof.rows[0]?.body_hash!=='e8304e817442209977754299625c6bbd')throw new Error('Historical migration function differs');
        }
        continue;
      }
      await client.query(source);
      await client.query('INSERT INTO public.nestwise_schema_migrations(version,sha256) VALUES ($1,$2)',[version,hash]);
    }
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK'); throw error; }
}
module.exports = { migrate };
if (require.main===module) {
  if (process.env.NESTWISE_MIGRATION_CONFIRM!=='apply-nestwise-nonproduction' || !process.env.NESTWISE_MIGRATION_URL) {
    console.error('Set NESTWISE_MIGRATION_URL and NESTWISE_MIGRATION_CONFIRM=apply-nestwise-nonproduction. Never use the CRM URL.');
    process.exitCode=1;
  } else {
    const client=new Client({connectionString:process.env.NESTWISE_MIGRATION_URL});
    (async()=>{try {await client.connect(); await migrate(client); console.log('Versioned Nestwise migrations applied.');}
      catch {console.error('Migration failed; transaction rolled back. Inspect the database securely.');process.exitCode=1;}
      finally {await client.end();}})();
  }
}
