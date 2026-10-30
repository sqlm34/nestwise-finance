const {test}=require('node:test');
const assert=require('node:assert/strict');
const {automaticUpdate}=require('../.test-build/src/domain/automatic-update.js');
function setup(){
 const state={canApply:true,pending:false,checking:false,downloading:false,foreground:true,keyboard:false};
 const calls={check:0,download:0,reload:0};let now=0;
 const driver={state:()=>state,now:()=>now,check:async()=>{calls.check++;return {isAvailable:true};},download:async()=>{calls.download++;state.pending=true;},reload:async()=>{calls.reload++;}};
 return {state,calls,driver,advance:()=>{now+=300_000;}};
}
test('downloads automatically, defers application during editing/background, reloads once on safe overview',async()=>{
 const s=setup(),m=automaticUpdate(s.driver);await m.check();assert.equal(s.calls.download,1);
 for(const blocked of [{canApply:false},{foreground:false},{keyboard:true}]){Object.assign(s.state,{canApply:true,foreground:true,keyboard:false},blocked);await m.apply();assert.equal(s.calls.reload,0);}
 Object.assign(s.state,{canApply:true,foreground:true,keyboard:false});await m.apply();await m.apply();assert.equal(s.calls.reload,1);
});
test('offline checks back off, never overlap, and unmount prevents a late download or reload',async()=>{
 const s=setup();s.driver.check=async()=>{s.calls.check++;throw new Error('offline');};const m=automaticUpdate(s.driver);
 await m.check();await m.check();assert.equal(s.calls.check,1);s.advance();await m.check();assert.equal(s.calls.check,2);
 let resolve;s.driver.check=()=>new Promise(r=>{s.calls.check++;resolve=r;});s.advance();const pending=m.check();await m.check();assert.equal(s.calls.check,3);
 m.stop();resolve({isAvailable:true});await pending;s.state.pending=true;await m.apply();assert.equal(s.calls.download,0);assert.equal(s.calls.reload,0);
});
test('native startup download is not duplicated and a failed reload is throttled',async()=>{
 const s=setup();s.state.downloading=true;const m=automaticUpdate(s.driver);await m.check();assert.equal(s.calls.check,0);
 s.state.pending=true;s.driver.reload=async()=>{s.calls.reload++;throw new Error('unavailable');};await m.apply();await m.apply();assert.equal(s.calls.reload,1);s.advance();await m.apply();assert.equal(s.calls.reload,2);
});
