const {test}=require('node:test');
const {Buffer}=require('node:buffer');
const assert=require('node:assert/strict');
const {randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {manifest,seal,open,restore}=require('../scripts/document-recovery.cjs');
function fixture(){
  const bytes=Buffer.from('SYNTHETIC recovery evidence only');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const object={key:`receipts/v1/95000000-0000-4000-8000-000000000001/96000000-0000-4000-8000-000000000011/${sha256}`,sha256,bytes:bytes.length};
  return {bytes,key:randomBytes(32),inventory:{schemaVersion:1,environment:'staging',objects:[object]}};
}
test('document archive authenticates encrypted inventory and bytes; rejects damage and wrong keys',()=>{
  const f=fixture(),archive=seal(f.inventory,[f.bytes],f.key);
  assert.equal(archive.includes(f.bytes),false);
  assert.equal(archive.includes(Buffer.from(f.inventory.objects[0].key)),false);
  assert.deepEqual(open(archive,f.key).documents,[f.bytes]);
  assert.throws(()=>open(archive,randomBytes(32)));
  for(const offset of [0,10,25,40,archive.length-1]){const damaged=Buffer.from(archive);damaged[offset]^=1;assert.throws(()=>open(damaged,f.key));}
  assert.throws(()=>open(archive.subarray(0,-1),f.key));
  assert.throws(()=>open(Buffer.concat([archive,Buffer.from('extra')]),f.key));
  assert.throws(()=>seal(f.inventory,[Buffer.from('wrong content')],f.key));
});
test('inventory rejects unsafe keys, duplicate identities, oversized inputs and unknown environments',()=>{
  const f=fixture();
  for(const key of ['../secret','C:/secret',f.inventory.objects[0].key+'/../secret',f.inventory.objects[0].key.toUpperCase()]){
    assert.throws(()=>manifest({...f.inventory,objects:[{...f.inventory.objects[0],key}]}));
  }
  assert.throws(()=>manifest({...f.inventory,environment:'crm'}));
  assert.throws(()=>manifest({...f.inventory,objects:[f.inventory.objects[0],f.inventory.objects[0]]}));
  assert.throws(()=>manifest({...f.inventory,objects:[{...f.inventory.objects[0],bytes:5_000_001}]}));
  assert.throws(()=>manifest({...f.inventory,objects:[{...f.inventory.objects[0],sha256:'0'.repeat(64)}]}));
});
test('restore verifies before extraction and never overwrites an existing directory',()=>{
  const f=fixture(),archive=seal(f.inventory,[f.bytes],f.key);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nestwise-recovery-test-'));
  try{
    const destination=path.join(root,'restored');
    assert.throws(()=>restore(archive,randomBytes(32),destination));assert.equal(fs.existsSync(destination),false);
    assert.equal(restore(archive,f.key,destination),1);
    assert.deepEqual(fs.readFileSync(path.join(destination,f.inventory.objects[0].key)),f.bytes);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination,'inventory.json'),'utf8')),f.inventory);
    assert.throws(()=>restore(archive,f.key,destination));
    assert.deepEqual(fs.readFileSync(path.join(destination,f.inventory.objects[0].key)),f.bytes);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
