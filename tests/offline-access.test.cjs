const test=require('node:test'),assert=require('node:assert/strict');
const {encodeOfflineAccess,decodeOfflineAccess,offlineAccessLifetime}=require('../.test-build/src/domain/offline-access');
const {accountChoices}=require('../.test-build/src/domain/account-choices');
const account=(id,name)=>({id:`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`,name,currency:'USD'});
const space={id:'00000000-0000-4000-8000-000000000010',name:'Personal',kind:'personal',role:'owner',accounts:[account(1,'Chase'),account(2,'Chase · 1234'),account(3,'Old National Bank'),account(4,'Old National · 5678')]};
const access={user:{id:'user-a',name:'User',email:'a@example.test'},workspaces:[space]};
test('local capture snapshot is bound to origin, expires and rejects corrupt or future data',()=>{
 const encoded=encodeOfflineAccess('https://stage.example',access,1000);
 assert.deepEqual(decodeOfflineAccess(encoded,'https://stage.example',1001),access);
 for(const raw of [null,'{',JSON.stringify({origin:'https://stage.example',at:1000,access:{}})])assert.equal(decodeOfflineAccess(raw,'https://stage.example',1001),null);
 assert.equal(decodeOfflineAccess(encoded,'https://prod.example',1001),null);
 assert.equal(decodeOfflineAccess(encoded,'https://stage.example',999),null);
 assert.equal(decodeOfflineAccess(encoded,'https://stage.example',1001+offlineAccessLifetime),null);
});
test('read-only membership never grants local capture',()=>{
 const readonly={...access,workspaces:[{...space,role:'reviewer'}]};
 assert.equal(decodeOfflineAccess(encodeOfflineAccess('x',readonly,1),'x',2).workspaces.length,0);
 assert.equal(decodeOfflineAccess(JSON.stringify({origin:'x',at:1,access:readonly}),'x',2),null);
});
test('bank choices retain every ID and put connected accounts first without moving records',()=>{
 const groups=accountChoices(space);assert.deepEqual(groups.primary.map(a=>a.name),['Chase · 1234','Old National · 5678']);
 assert.deepEqual(groups.older.map(a=>a.name),['Chase','Old National Bank']);
 assert.equal(new Set([...groups.primary,...groups.older].map(a=>a.id)).size,4);
 assert.equal(space.accounts[0].name,'Chase');
});
test('no duplicate or business account is hidden without an exact personal bank match',()=>{
 for(const value of [{...space,kind:'business'},{...space,accounts:[account(1,'Chase')]},{...space,accounts:[account(1,'Chase Business'),account(2,'Chase · 1234')]}])assert.equal(accountChoices(value).older.length,0);
});
