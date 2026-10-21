const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,writeFileSync,unlinkSync,rmdirSync}=require('node:fs');
const {tmpdir}=require('node:os');const {join}=require('node:path');const {createHash}=require('node:crypto');
const {migrate}=require('../scripts/migrate.cjs');
test('migration replay accepts exact LF/CRLF variants but rejects changed SQL',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'nestwise-migration-')),file=join(dir,'0001_proof.sql');
 const canonical='SELECT 1;\nSELECT 2;\n';let stored=createHash('sha256').update(canonical.replace(/\n/g,'\r\n')).digest('hex'),executed=false;
 const client={query:async q=>{if(q.includes('current_database()'))return {rows:[{name:'nestwise_test'}]};if(q.includes("to_regclass('public.jobs')"))return {rows:[{found:null}]};if(q==='SELECT version,sha256 FROM public.nestwise_schema_migrations')return {rows:[{version:'0001_proof.sql',sha256:stored}]};if(q.startsWith('SELECT 1;'))executed=true;return {rows:[]};}};
 try{writeFileSync(file,canonical);await migrate(client,dir);assert.equal(executed,false);
 stored=createHash('sha256').update(canonical).digest('hex');writeFileSync(file,canonical.replace(/\n/g,'\r\n'));await migrate(client,dir);assert.equal(executed,false);
 writeFileSync(file,canonical.replace('SELECT 2','SELECT 3'));await assert.rejects(migrate(client,dir),/Previously applied migration changed/);
 }finally{unlinkSync(file);rmdirSync(dir);}
});

test('attested 0014 checksum requires the exact source and deployed function',async()=>{
 const fs=require('node:fs'),dir=mkdtempSync(join(tmpdir(),'nestwise-history-')),file=join(dir,'0014_manual_operations.sql');
 let body='e8304e817442209977754299625c6bbd';const calls=[];
 const client={query:async q=>{calls.push(q);if(q.includes('current_database()'))return {rows:[{name:'nestwise_staging'}]};if(q.includes("to_regclass('public.jobs')"))return {rows:[{found:null}]};if(q==='SELECT version,sha256 FROM public.nestwise_schema_migrations')return {rows:[{version:'0014_manual_operations.sql',sha256:'37cc3c0bb2c28aba824cf178d5f10313c799f1996bef8d404cb6177c38893a51'}]};if(q.includes('AS body_hash'))return {rows:[{body_hash:body}]};return {rows:[]};}};
 try{const source=fs.readFileSync('db/migrations/0014_manual_operations.sql','utf8');writeFileSync(file,source);await migrate(client,dir);assert.ok(calls.includes('COMMIT'));assert.ok(!calls.some(q=>q.startsWith('INSERT INTO public.nestwise_schema_migrations')));
 body='unexpected';await assert.rejects(migrate(client,dir),/Historical migration function differs/);assert.equal(calls.at(-1),'ROLLBACK');
 writeFileSync(file,source+'-- changed\n');await assert.rejects(migrate(client,dir),/Previously applied migration changed/);
 }finally{unlinkSync(file);rmdirSync(dir);}
});
