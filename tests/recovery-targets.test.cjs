const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateTargets}=require('../scripts/verify-cloud-restore.cjs');
const {Client}=require('pg');
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

test('recovery URL checks cannot be bypassed through pg connection-string query overrides',()=>{
  const source=connection('source'),copy=connection('copy'),runtime=connection('copy','nestwise_worker');
  const attacks=['host=ep-source.c-7.us-east-2.aws.neon.tech','user=owner','port=5433',
    'sslmode=disable','sslmode=require','ssl=no-verify','uselibpqcompat=true',
    'options=-c%20role%3Dnestwise_worker','sslrootcert=untrusted.pem','sslcert=client.pem',
    'sslkey=client.key','password=override','database=crm','channel_binding=require'];
  for(const attack of attacks){
    for(const index of [0,1,2]){
      const urls=[source,copy,runtime];urls[index]+='&'+attack;
      assert.throws(()=>validateTargets(...urls),`${index}: ${attack}`);
    }
  }
  assert.throws(()=>validateTargets(source,copy.replace('.tech/', '.tech:5433/'),runtime));
  assert.throws(()=>validateTargets(source,copy+'#fragment',runtime));
  // Constructing a pg Client does not open a connection. Check the installed
  // parser's effective targets to prevent validator/parser divergence.
  const validated=validateTargets(source,copy,runtime);
  for(const url of validated){
    const effective=new Client({connectionString:url.href}).connectionParameters;
    assert.equal(effective.host,url.hostname);
    assert.equal(effective.port,5432);
    assert.equal(effective.user,decodeURIComponent(url.username));
    assert.equal(effective.database,'nestwise_staging');
    assert.ok(effective.ssl);
    assert.notEqual(effective.ssl.rejectUnauthorized,false);
    assert.equal(effective.ssl.checkServerIdentity,undefined);
  }
});
