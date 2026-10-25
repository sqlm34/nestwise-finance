const assert=require('node:assert/strict');

// Production requires a deliberately named mode AND an action-specific phrase.
// Existing callers remain confined to the non-production database names.
function productionMode(options={},confirmation) {
  const environment=options.environment??'nonproduction';
  assert.ok(['nonproduction','production'].includes(environment),'Unknown administrative environment');
  if(environment==='production')assert.equal(options.confirm,confirmation,'Explicit production confirmation required');
  return environment==='production';
}
function validateAdminIdentity(name,role,production) {
  if(production){
    assert.equal(name,'nestwise_production','Production database name must match exactly');
    assert.equal(role,'nestwise_production_owner','Use the dedicated production administrative identity');
  }else assert.match(name,/^nestwise_(development|staging|test)$/,'Non-production database required');
}
module.exports={productionMode,validateAdminIdentity};
