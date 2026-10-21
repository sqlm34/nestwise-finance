const {test}=require('node:test');const assert=require('node:assert/strict');
const {parseDraft,transitionDraft,submitDraft}=require('../.test-build/src/domain/operation-draft.js');
const scope={origin:'https://staging.invalid',user:'owner',workspace:'space',account:'account'};
const operation={id:'97000000-0000-4000-8000-000000000001',kind:'expense',paid_on:'2026-10-21',amount_cents:'100',note:'SYNTHETIC',destination_account:null,reference_operation:null,allocations:[{category:'supplies',cents:'100'}]};
function storage(){let raw=null;return {read:async s=>parseDraft(raw,s),change:async(s,a)=>{raw=transitionDraft(raw,s,a);return parseDraft(raw,s);},get raw(){return raw;}};}
test('lost ACK survives reload and retries exactly one immutable financial command',async()=>{
 const store=storage(),booked=new Set();await store.change(scope,{type:'prepare',operation});
 await assert.rejects(submitDraft(store,scope,operation,async()=>{},async op=>{booked.add(op.id);throw Error('lost ACK');}));
 const reloaded=parseDraft(store.raw,scope);assert.equal(reloaded.phase,'pending');
 await assert.rejects(store.change(scope,{type:'discard',operation}));
 await assert.rejects(store.change(scope,{type:'prepare',operation:{...operation,id:'97000000-0000-4000-8000-000000000002'}}));
 await submitDraft(store,scope,reloaded.operation,async()=>{},async op=>{assert.deepEqual(op,operation);booked.add(op.id);});
 assert.equal(booked.size,1);assert.equal((await store.read(scope)).phase,'confirmed');
 await assert.rejects(submitDraft(store,scope,operation,async()=>{},async()=>assert.fail('must not resend confirmed')));
});
test('storage failure and revoked access stop network writes',async()=>{
 const store=storage();await store.change(scope,{type:'prepare',operation});let sends=0;
 await assert.rejects(submitDraft({...store,change:async()=>{throw Error('disk full');}},scope,operation,async()=>{},async()=>{sends++;}));
 await assert.rejects(submitDraft(store,scope,operation,async()=>{throw Error('revoked');},async()=>{sends++;}));
 assert.equal(sends,0);assert.equal((await store.read(scope)).phase,'prepared');
});
test('identity/environment/account isolation and corrupt payloads fail closed',async()=>{
 const store=storage();await store.change(scope,{type:'prepare',operation});
 for(const key of ['origin','user','workspace','account'])assert.throws(()=>parseDraft(store.raw,{...scope,[key]:'different'}));
 assert.throws(()=>parseDraft('{broken',scope));assert.throws(()=>parseDraft(store.raw.replace('"100"','"-1"'),scope));
});
test('stale tab cannot discard a submitted command or substitute changed amounts',async()=>{
 const store=storage();await store.change(scope,{type:'prepare',operation});
 await store.change(scope,{type:'pending',operation});
 await assert.rejects(store.change(scope,{type:'discard',operation}));
 await assert.rejects(store.change(scope,{type:'pending',operation:{...operation,note:'different'}}));
 assert.equal((await store.read(scope)).phase,'pending');
});
test('confirmation persistence failure retains pending ID and safe retry',async()=>{
 const store=storage();await store.change(scope,{type:'prepare',operation});let sends=0;
 const failing={...store,change:async(s,a)=>{if(a.type==='confirmed')throw Error('full');return store.change(s,a);}};
 await assert.rejects(submitDraft(failing,scope,operation,async()=>{},async()=>{sends++;}));
 assert.equal((await store.read(scope)).phase,'pending');
 await submitDraft(store,scope,operation,async()=>{},async()=>{sends++;});assert.equal(sends,2);
 await store.change(scope,{type:'discard',operation});assert.equal(await store.read(scope),null);
});
test('definitive server rejection unlocks correction but unknown failures retain pending identity',async()=>{
 const {DraftRejected}=require('../.test-build/src/domain/operation-draft.js');const store=storage();await store.change(scope,{type:'prepare',operation});
 await assert.rejects(submitDraft(store,scope,operation,async()=>{},async()=>{throw new DraftRejected('manual_refund_exceeded');}));
 assert.equal((await store.read(scope)).phase,'rejected');await store.change(scope,{type:'discard',operation});assert.equal(await store.read(scope),null);
});
