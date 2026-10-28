const {test}=require('node:test'),assert=require('node:assert/strict');
const {workingAccess,resolveSelection}=require('../.test-build/src/domain/live-navigation.js');
test('working navigation hides only the named OCR fixtures without changing permissions or source data',()=>{
 const account={id:'a',name:'Chase Business',currency:'USD'};
 const raw={user:{id:'u',name:'User',email:'user@example.invalid'},workspaces:[{id:'test',name:'SYNTHETIC — production OCR',accounts:[{...account,name:'SYNTHETIC OCR acceptance'}]},{id:'business',name:'Aksenov LLC',kind:'business',accounts:[account]},{id:'empty',name:'New workspace',accounts:[]}]};
 const visible=workingAccess(raw);assert.equal(raw.workspaces.length,3);assert.equal(visible.workspaces.length,2);assert(visible.workspaces.some(w=>w.id==='empty'));assert(!visible.workspaces.some(w=>w.id==='test'));assert.equal(resolveSelection(visible,JSON.stringify({workspace:'test',account:'a'})),null);assert.deepEqual(visible.workspaces.find(w=>w.id==='business').accounts,[account]);
});
