// Synthetic, loopback-only validation surface. Never reads cloud credentials.
const { PGlite } = require('@electric-sql/pglite');
const { createServer } = require('node:http');
const { randomUUID, randomBytes, createHash, createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createWorker } = require('../.test-build/worker/index.js');
(async () => {
  const db = new PGlite(); await db.waitReady;
  await db.exec(readFileSync('db/migrations/0001_ledger.sql','utf8'));
  const workspace=randomUUID(), account=randomUUID(), user=randomUUID(), token=randomBytes(32).toString('base64url');
  const secret=randomBytes(32), timestamp=Math.floor(Date.now()/1000), order='DEMO-125';
  await db.query("INSERT INTO nestwise.workspaces VALUES ($1,'Aksenov LLC — test','business')",[workspace]);
  await db.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'Synthetic clearing')",[account,workspace]);
  await db.query("INSERT INTO nestwise.users VALUES ($1,'demo-owner')",[user]);
  await db.query("INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true)",[workspace,user]);
  await db.query("INSERT INTO nestwise.sessions VALUES ($1,$2,now()+interval '8 hours',NULL)",[createHash('sha256').update(token).digest('hex'),user]);
  await db.query("INSERT INTO nestwise.source_connections VALUES ('demo-crm',$1,$2,true)",[workspace,account]);
  await db.exec('SET ROLE nestwise_api');
  const worker=createWorker(()=>({
    accept:async(...p)=>(await db.query('SELECT nestwise.accept_event($1,$2,$3,$4) result',p)).rows[0].result,
    journal:async(...p)=>(await db.query('SELECT nestwise.read_journal($1,$2,$3) result',p)).rows[0].result,
    processPending:async()=>{await db.query('SELECT nestwise.process_pending()');},
  }));
  const env={ENVIRONMENT:'development',FINANCIAL_INGESTION_ENABLED:'true',NESTWISE_DATABASE_URL:'memory-only',
    CRM_SERVICE_KEYS:JSON.stringify({demo:{connectionId:'demo-crm',secret:secret.toString('hex'),notBefore:timestamp-1,expiresAt:timestamp+28800}})};
  const payment={schema_version:1,source_event_id:randomUUID(),source_order_id:order,source_fact_id:randomUUID(),
    order_revision:1,type:'job.payment_recorded',currency:'USD',occurred_at:'2026-10-19T12:00:00Z',
    paid_at:'2026-10-19T12:00:00Z',amount_cents:35000};
  const part={...payment,source_event_id:randomUUID(),source_fact_id:randomUUID(),order_revision:2,type:'job.part_cost_recorded',amount_cents:9500,settlement:'paid'};
  const refund={...payment,source_event_id:randomUUID(),source_fact_id:randomUUID(),order_revision:3,type:'job.customer_refund_issued',reference_event_id:payment.source_event_id};
  const trace=[];
  async function deliver(event,label) {
    const raw=JSON.stringify(event), nonce=randomUUID(), at=Math.floor(Date.now()/1000);
    const canonical=['v1','POST','/v1/crm/events','demo-crm','demo',at,nonce,createHash('sha256').update(raw).digest('hex')].join('\n');
    const response=await worker.fetch(new Request('http://127.0.0.1:8082/v1/crm/events',{method:'POST',body:raw,headers:{
      'content-type':'application/json','x-nw-connection':'demo-crm','x-nw-key-id':'demo','x-nw-nonce':nonce,
      'x-nw-timestamp':String(at),'x-nw-signature':createHmac('sha256',secret).update(canonical).digest('hex'),
    }}),env);
    const result=await response.json();
    if(response.status!==202) throw new Error('Demo ingestion failed');
    trace.push({label,revision:event.order_revision,...result});
  }
  await deliver(refund,'Возврат пришёл раньше оплаты');
  await deliver(payment,'Оплата клиента');
  await deliver(part,'Запчасть — пропущенная ревизия');
  await deliver(refund,'Повторная доставка возврата');
  let accessDenied=false;
  try {await db.query('SELECT * FROM nestwise.journal_entries');}
  catch {accessDenied=true;}
  const html=readFileSync('reference/ledger-demo.html');
  createServer(async(req,res)=>{
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(req.method!=='GET'||!['127.0.0.1:8082','localhost:8082'].includes(req.headers.host)) {
      res.writeHead(404,headers);res.end();return;
    }
    if(req.url==='/') {res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
    if(req.url==='/report') {
      try {
        const response=await worker.fetch(new Request(`http://127.0.0.1:8082/v1/workspaces/${workspace}/accounts/${account}/journal`,
          {headers:{authorization:`Bearer ${token}`}}),env);
        const data=await response.json();
        res.writeHead(response.status,{...headers,'Content-Type':'application/json'});
        res.end(JSON.stringify({...data,trace,accessDenied,database:'PostgreSQL / PGlite',synthetic:true}));
      } catch {res.writeHead(503,headers);res.end();}
      return;
    }
    res.writeHead(404,headers);res.end();
  }).listen(8082,'127.0.0.1',()=>console.log('Synthetic ledger demo: http://127.0.0.1:8082 — no cloud database or CRM connection.'));
})().catch(error=>{console.error('Local demo failed:',error.message);process.exitCode=1;});
