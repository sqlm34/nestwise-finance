const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateTargets}=require('../scripts/verify-cloud-restore.cjs');
const connection=(endpoint,user='owner',database='nestwise_staging')=>
  `postgresql://${user}:synthetic@ep-${endpoint}.c-7.us-east-2.aws.neon.tech/${database}?sslmode=require`;
test('recovery guard requires separate staging endpoints and restricted runtime identity',()=>{
  assert.equal(validateTargets(connection('source'),connection('copy'),connection('copy','nestwise_worker')).length,3);
  assert.throws(()=>validateTargets(connection('source'),connection('source-pooler'),connection('source','nestwise_worker')));
  assert.throws(()=>validateTargets(connection('source'),connection('copy'),connection('third','nestwise_worker')));
  assert.throws(()=>validateTargets(connection('source'),connection('copy'),connection('copy')));
  assert.throws(()=>validateTargets(connection('source','owner','crm'),connection('copy'),connection('copy','nestwise_worker')));
  assert.throws(()=>validateTargets(connection('source').replace('sslmode=require','sslmode=disable'),connection('copy'),connection('copy','nestwise_worker')));
});
