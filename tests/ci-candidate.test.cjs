const {test}=require('node:test');
const assert=require('node:assert/strict');
const {approvedRun}=require('../scripts/verify-ci-candidate.cjs');
test('production preparation rejects stale, unrelated or superseded CI success',()=>{
  const sha='a'.repeat(40),run={id:1,head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success'};
  assert.equal(approvedRun([run],sha),1);
  for(const patch of [{head_sha:'b'.repeat(40)},{head_branch:'feature/test'},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'}]){
    assert.throws(()=>approvedRun([{...run,...patch}],sha));
  }
  assert.throws(()=>approvedRun([run,{...run,id:2,status:'in_progress',conclusion:null}],sha));
  assert.throws(()=>approvedRun([run],'main'));assert.throws(()=>approvedRun([],sha));
});
