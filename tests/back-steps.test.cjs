const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createBackSteps}=require('../.test-build/src/domain/back-steps.js');

test('back closes transaction, filters, then overview drill without popping route',()=>{
  const steps=createBackSteps(),closed=[];
  // Registration order must not let the parent swallow the deeper screen.
  const transaction=steps.add(30,()=>closed.push('transaction'));
  const drill=steps.add(10,()=>closed.push('drill'));
  const filters=steps.add(20,()=>closed.push('filters'));
  assert.equal(steps.back(),true);transaction();
  assert.equal(steps.back(),true);filters();
  assert.equal(steps.back(),true);drill();
  assert.equal(steps.back(),false);
  assert.deepEqual(closed,['transaction','filters','drill']);
});
test('leaving a route removes its local steps and another account stays isolated',()=>{
  const first=createBackSteps(),second=createBackSteps();let called=false;
  const leave=first.add(30,()=>{called=true;});
  assert.equal(second.back(),false);
  leave();leave();assert.equal(first.back(),false);assert.equal(called,false);
});
