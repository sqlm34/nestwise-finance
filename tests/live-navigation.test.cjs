const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseAccess,resolveSelection,selectionKey}=require('../.test-build/src/domain/live-navigation.js');
const w='94000000-0000-4000-8000-000000000001',a='94000000-0000-4000-8000-000000000002',b='94000000-0000-4000-8000-000000000003';
const access={user:{id:'auth-owner',name:'Synthetic owner',email:'owner@example.invalid'},workspaces:[{id:w,name:'Synthetic',role:'owner',accounts:[{id:a,name:'Current account',currency:'USD'}]}]};
test('restored selection uses current authorized name and currency, not stored fields',()=>{
 assert.deepEqual(resolveSelection(parseAccess(access),JSON.stringify({workspace:w,account:a,name:'Old name',currency:'EUR'})),{workspace:w,account:a,name:'Current account',currency:'USD'});
});
test('revoked, wrong workspace, corrupt and unknown selections require explicit choice',()=>{
 for(const value of [null,'invalid','null','[]',JSON.stringify({workspace:w,account:b}),JSON.stringify({workspace:b,account:a})])assert.equal(resolveSelection(access,value),null);
 assert.equal(resolveSelection({...access,workspaces:[]},JSON.stringify({workspace:w,account:a})),null);
});
test('selection storage is isolated by authenticated identity',()=>{assert.notEqual(selectionKey('alice'),selectionKey('bob'));assert.notEqual(selectionKey('a/b'),selectionKey('a%2Fb'));});
test('malformed access fails closed before any financial component mounts',()=>{
 for(const value of [null,{}, {...access,user:{}},{...access,workspaces:[...access.workspaces,...access.workspaces]},{...access,workspaces:[{...access.workspaces[0],role:'admin'}]},{...access,workspaces:[{...access.workspaces[0],accounts:[{id:a,name:'A',currency:'$'}]}]}])assert.throws(()=>parseAccess(value),/invalid_access/);
 assert.equal(parseAccess(access).workspaces.length,1);
});
