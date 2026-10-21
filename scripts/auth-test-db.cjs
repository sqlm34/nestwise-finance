// Single-connection test adapter. Never used by the deployed Worker.
const {PGlite}=require('@electric-sql/pglite');
async function authTestDatabase() {
  const db=new PGlite(); await db.waitReady;
  let unlock=Promise.resolve();
  const pool={options:{},end:async()=>{},connect:async()=>{
    const before=unlock; let release;
    unlock=new Promise(resolve=>{release=resolve;}); await before;
    return {release,query:async(sql,parameters)=>{
      const result=await db.query(sql,parameters);
      return {...result,rowCount:result.affectedRows??result.rows.length,command:sql.trim().split(/\s/)[0].toUpperCase()};
    }};
  }};
  return {db,pool};
}
module.exports={authTestDatabase};
