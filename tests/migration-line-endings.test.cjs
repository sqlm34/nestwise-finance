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
