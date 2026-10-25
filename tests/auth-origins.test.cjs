const {test}=require('node:test');
const assert=require('node:assert/strict');
const {nativeAppOrigin,trustedNativeOrigin}=require('../.test-build/worker/auth-origins.js');
const {authConfiguration,userApi}=require('../.test-build/worker/user-api.js');

test('native origins match application schemes and reject unknown environments',()=>{
  assert.equal(nativeAppOrigin('development'),'nestwise-development://');
  assert.equal(nativeAppOrigin('staging'),'nestwise-staging://');
  assert.equal(nativeAppOrigin('production'),'nestwise://');
  for(const environment of ['', 'preview','Production','constructor','__proto__'])assert.equal(nativeAppOrigin(environment),null);
});

test('native write origin requires exact application and configured environment match',()=>{
  for(const environment of ['development','staging','production']){
    const correct=nativeAppOrigin(environment),trusted=['https://example.test',correct];
    assert.equal(trustedNativeOrigin(correct,trusted),true);
    for(const origin of [null,'', 'https://example.test',`${correct}attacker.test`,`${correct}/`,`${correct}path`,`${correct}?query`,`${correct}#fragment`,'nestwise-production://','nestwise-evil://']){
      assert.equal(trustedNativeOrigin(origin,trusted),false,`${environment}: ${origin}`);
    }
    for(const other of ['development','staging','production'].filter(value=>value!==environment))assert.equal(trustedNativeOrigin(nativeAppOrigin(other),trusted),false);
  }
  assert.equal(trustedNativeOrigin('nestwise-evil://',['nestwise-evil://']),false);
});

test('correct production scheme does not activate production authentication',async()=>{
  const env={ENVIRONMENT:'production',AUTH_ENABLED:'true',AUTH_DATABASE_URL:'unused',NESTWISE_DATABASE_URL:'unused',AUTH_SECRET:'x'.repeat(32),AUTH_BASE_URL:'https://example.test',AUTH_WEB_ORIGIN:'https://example.test'};
  assert.equal(authConfiguration(env),null);
  const response=await userApi(new Request('https://example.test/v1/session',{headers:{'expo-origin':'nestwise://'}}),env,async()=>{throw new Error('Must not connect');});
  assert.equal(response.status,404);
});
