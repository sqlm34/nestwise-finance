const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {reviewEvidence,statementFingerprints,parseEvidenceReview}=require('../.test-build/src/domain/statement-evidence.js');
const {previewStatement}=require('../.test-build/src/domain/statement.js');
const digest=text=>createHash('sha256').update(text).digest('hex');
const text='Date,Description,Amount\n10/20/2026,Customer payment,10.00\n10/20/2026,Processor fee,-1.00\n10/20/2026,Unresolved,2.00';
const hash=digest(text),checked='2026-10-20T22:00:00.000Z';
const group=()=>({id:randomUUID(),file_hash:hash,rows:[{line:2,date:'2026-10-20',cents:'1000',text_hash:digest('customer payment')},{line:3,date:'2026-10-20',cents:'-100',text_hash:digest('processor fee')}],transactions:[randomUUID()]});
const fingerprints=()=>statementFingerprints(previewStatement(text,'chase','Demo').rows,async text=>digest(text));
test('evidence validates an entire group and reconciles exact credit/debit coverage totals',async()=>{
  const report=reviewEvidence(text,hash,await fingerprints(),{groups:[group()],reserved:[],canceled:2},'primary',checked);
  assert.deepEqual(report.rows.map(row=>row.status),['matched','matched','unmatched']);
  assert.deepEqual(report.totals.matched,{count:2,credits:'1000',debits:'100'});assert.equal(report.totals.unmatched.credits,'200');
  assert.deepEqual(parseEvidenceReview(report,hash),report);
  assert.throws(()=>parseEvidenceReview({...report,totals:{...report.totals,matched:{count:2,credits:'900',debits:'0'}}},hash));
});
test('one wrong date, amount, description or missing line invalidates all rows in the group',async()=>{
  for(const bad of [{date:'2026-10-19'},{cents:'-99'},{text_hash:digest('fabricated')},{line:9}]){
    const assertion=group();Object.assign(assertion.rows[1],bad);
    const report=reviewEvidence(text,hash,await fingerprints(),{groups:[assertion],reserved:[],canceled:0},'backup',checked);
    assert.equal(report.groups[0].valid,false);assert.equal(report.rows[0].status,'mismatch');assert.equal(report.totals.matched.count,0);
  }
});
test('overlapping groups cannot produce false verified coverage',async()=>{
  const report=reviewEvidence(text,hash,await fingerprints(),{groups:[group(),group()],reserved:[],canceled:0},'primary',checked);
  assert.equal(report.totals.matched.count,0);assert.equal(report.totals.mismatch.count,2);
});
test('another file reserves matching fingerprints without claiming the current file is reconciled',async()=>{
  const prints=await fingerprints();const report=reviewEvidence(text,hash,prints,{groups:[],reserved:[{fingerprint:prints.get(2),group_id:randomUUID()}],canceled:3},'primary',checked);
  assert.deepEqual(report.rows.map(row=>row.status),['reserved','unmatched','unmatched']);assert.equal(report.totals.matched.count,0);
});

test('permanent bank posting stays visible after cancellation and in overlapping statements',async()=>{
  const prints=await fingerprints(),booked=[{id:randomUUID(),transaction:randomUUID(),fingerprint:prints.get(3)}];
  const report=reviewEvidence(text,hash,prints,{groups:[],reserved:[],booked,canceled:1},'primary',checked);
  assert.equal(report.rows[1].status,'posted');assert.equal(report.totals.posted.debits,'100');
  assert.equal(report.totals.matched.count,0);assert.deepEqual(parseEvidenceReview(report,hash),report);
  const broken=group();broken.rows[1].cents='-99';
  const mismatch=reviewEvidence(text,hash,prints,{groups:[broken],reserved:[],booked,canceled:0},'primary',checked);
  assert.equal(mismatch.rows[1].status,'mismatch','posting evidence must not hide conflicting reconciliation evidence');
  assert.throws(()=>reviewEvidence(text,hash,prints,{groups:[],reserved:[],booked:[...booked,...booked],canceled:0},'primary',checked));
});
test('duplicate and zero rows remain blocked and malformed report payloads fail closed',async()=>{
  const duplicate='Date,Description,Amount\n10/20/2026,Same,1.00\n10/20/2026,Same,1.00\n10/20/2026,Zero,0.00';
  const prints=await statementFingerprints(previewStatement(duplicate,'chase','Demo').rows,async text=>digest(text));
  const report=reviewEvidence(duplicate,digest(duplicate),prints,{groups:[],reserved:[],canceled:0},'primary',checked);
  assert.deepEqual(report.rows.map(row=>row.status),['blocked','blocked','blocked']);
  assert.throws(()=>parseEvidenceReview({...report,rows:[...report.rows,report.rows[0]]},report.hash));
  assert.throws(()=>reviewEvidence(text,hash,new Map(),{groups:[{...group(),file_hash:'a'.repeat(64)}],reserved:[],canceled:0},'primary',checked));
});
