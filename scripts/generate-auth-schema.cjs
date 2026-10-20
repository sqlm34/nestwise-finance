// Generate into a new migration only; review generated SQL before deployment.
const {writeFileSync}=require('node:fs');
(async()=>{
  const {db,pool}=await require('./auth-test-db.cjs').authTestDatabase();
  try {
    const {createAuth}=require('../.test-build/worker/auth.js');
    const auth=await createAuth({baseURL:'http://localhost:8083',secret:'schema-generation-only-not-a-real-secret',origins:[],development:true},pool);
    const {getMigrations}=await import('better-auth/db/migration');
    const plan=await getMigrations(auth.options);
    const sql=await plan.compileMigrations();
    writeFileSync('db/migrations/0002_auth.sql','-- Generated from Better Auth 1.7.12; reviewed, versioned, applied by owner only.\n'+sql+
      '\nCREATE ROLE nestwise_auth_api NOLOGIN;\nREVOKE ALL ON SCHEMA nestwise_auth FROM PUBLIC;\nGRANT USAGE ON SCHEMA nestwise_auth TO nestwise_auth_api;\nGRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA nestwise_auth TO nestwise_auth_api;\n',{flag:'wx'});
  } finally {await db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
