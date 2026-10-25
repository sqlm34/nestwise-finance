const assert=require('node:assert/strict');
function approvedRun(runs,sha){
  assert.match(sha,/^[a-f0-9]{40}$/);
  const matching=runs.filter(run=>run.head_sha===sha&&run.head_branch==='main'&&run.event==='push')
    .sort((a,b)=>b.id-a.id);
  assert.ok(matching.length&&matching[0].status==='completed'&&matching[0].conclusion==='success','Latest CI for this exact main revision must succeed');
  return matching[0].id;
}
module.exports={approvedRun};
if(require.main===module)(async()=>{
  assert.equal(process.env.GITHUB_REF,'refs/heads/main');
  assert.equal(process.env.GITHUB_REPOSITORY,'sqlm34/nestwise-finance');
  const sha=process.env.GITHUB_SHA;assert.match(sha,/^[a-f0-9]{40}$/);
  const response=await fetch(`https://api.github.com/repos/sqlm34/nestwise-finance/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&per_page=20`,
    {headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,'User-Agent':'Nestwise-release'},signal:AbortSignal.timeout(30000)});
  assert.ok(response.ok);const result=await response.json();
  console.log(JSON.stringify({source:sha,successfulMainCI:approvedRun(result.workflow_runs,sha),productionActivation:false}));
})().catch(()=>{console.error('Candidate rejected: exact main CI verification failed. No credentials logged.');process.exitCode=1;});
