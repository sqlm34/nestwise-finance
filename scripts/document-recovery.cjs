/* global __dirname */
// Manual off-provider recovery. Plaintext documents and keys never use temp files.
const fs=require('node:fs');
const {Buffer}=require('node:buffer');
const path=require('node:path');
const {randomBytes,createHash,createCipheriv,createDecipheriv}=require('node:crypto');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const MAGIC=Buffer.from('NWREC001');
const MAX_BYTES=50_000_000,MAX_ARCHIVE=70_000_000;
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const objectKey=new RegExp(`^(?:receipts/)?v1/${uuid}/${uuid}/([a-f0-9]{64})$`);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function manifest(value){
  assert.ok(value&&Object.keys(value).sort().join(',')==='environment,objects,schemaVersion');
  assert.equal(value.schemaVersion,1);
  assert.ok(['staging','production'].includes(value.environment));
  assert.ok(Array.isArray(value.objects)&&value.objects.length<=500);
  let size=0;const keys=new Set();
  for(const item of value.objects){
    assert.ok(item&&Object.keys(item).sort().join(',')==='bytes,key,sha256');
    const match=typeof item.key==='string'&&objectKey.exec(item.key);
    assert.ok(match&&match[1]===item.sha256&&!keys.has(item.key),'Invalid or duplicate object identity');
    assert.ok(Number.isSafeInteger(item.bytes)&&item.bytes>0&&item.bytes<=5_000_000);
    keys.add(item.key);size+=item.bytes;
  }
  assert.ok(size<=MAX_BYTES,'Split inventories larger than 50 MB into separate archives');
  return value;
}
function seal(inventory,documents,key){
  manifest(inventory);assert.equal(key.length,32);assert.equal(documents.length,inventory.objects.length);
  const data=documents.map((bytes,index)=>{
    assert.equal(bytes.length,inventory.objects[index].bytes);assert.equal(hash(bytes),inventory.objects[index].sha256);
    return bytes.toString('base64');
  });
  const plaintext=Buffer.from(JSON.stringify({inventory,data}));
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(MAGIC);
  try {const encrypted=Buffer.concat([cipher.update(plaintext),cipher.final()]);return Buffer.concat([MAGIC,nonce,cipher.getAuthTag(),encrypted]);}
  finally {plaintext.fill(0);}
}
function open(archive,key){
  assert.ok(archive.length>=36&&archive.length<=MAX_ARCHIVE);assert.equal(key.length,32);
  assert.ok(archive.subarray(0,8).equals(MAGIC));
  const decipher=createDecipheriv('aes-256-gcm',key,archive.subarray(8,20));
  decipher.setAAD(MAGIC);decipher.setAuthTag(archive.subarray(20,36));
  const plaintext=Buffer.concat([decipher.update(archive.subarray(36)),decipher.final()]);
  try {
    const payload=JSON.parse(plaintext.toString('utf8'));assert.equal(Object.keys(payload).sort().join(','),'data,inventory');
    manifest(payload.inventory);assert.equal(payload.data.length,payload.inventory.objects.length);
    const documents=payload.data.map((data,index)=>{
      assert.ok(typeof data==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data));
      const bytes=Buffer.from(data,'base64'),item=payload.inventory.objects[index];
      assert.equal(bytes.length,item.bytes);assert.equal(hash(bytes),item.sha256);return bytes;
    });
    return {inventory:payload.inventory,documents};
  } finally {plaintext.fill(0);}
}
function noLinks(target){
  let current=path.resolve(target);
  for(;;){if(fs.existsSync(current))assert.ok(!fs.lstatSync(current).isSymbolicLink(),'Symlinks are not allowed');const parent=path.dirname(current);if(parent===current)break;current=parent;}
}
function restore(archive,key,destination){
  const result=open(archive,key);destination=path.resolve(destination);noLinks(destination);
  assert.ok(!fs.existsSync(destination),'Restore only into a new directory');
  fs.mkdirSync(destination); // All integrity checks finish before creating plaintext files.
  try {
    result.inventory.objects.forEach((item,index)=>{
      const target=path.join(destination,...item.key.split('/'));
      fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,result.documents[index],{flag:'wx',mode:0o600});
    });
    fs.writeFileSync(path.join(destination,'inventory.json'),JSON.stringify(result.inventory,null,2),{flag:'wx',mode:0o600});
    return result.inventory.objects.length;
  } finally {for(const bytes of result.documents)bytes.fill(0);}
}
function dpapi(action,bytes){
  assert.equal(process.platform,'win32','This key protector requires Windows');
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'recovery-key.ps1'),'-Action',action],
    {input:bytes.toString('base64'),encoding:'utf8',windowsHide:true,maxBuffer:8192});
  assert.ok(!result.error&&result.status===0,'Windows key protection failed');
  return Buffer.from(result.stdout.trim(),'base64');
}
function loadKey(file){noLinks(file);assert.ok(fs.statSync(file).size<=8192);const key=dpapi('unprotect',fs.readFileSync(file));assert.equal(key.length,32);return key;}
function fetchOriginal(bucket,item){
  const result=spawnSync(process.execPath,[path.join(__dirname,'../node_modules/wrangler/bin/wrangler.js'),'r2','object','get',`${bucket}/${item.key}`,'--remote','--pipe'],
    {windowsHide:true,maxBuffer:5_100_000,timeout:120000,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
  assert.ok(!result.error&&result.status===0,'Object download failed; credentials and object contents not logged');
  assert.equal(result.stdout.length,item.bytes);assert.equal(hash(result.stdout),item.sha256);return result.stdout;
}
async function main(args){
  const [action,keyFile,input,output]=args;
  if(action==='init-key'){
    assert.equal(args.length,2);noLinks(keyFile);const key=randomBytes(32);
    try{fs.writeFileSync(keyFile,dpapi('protect',key),{flag:'wx',mode:0o600});}finally{key.fill(0);}
    console.log('Recovery key protected for this Windows user. Keep the Windows profile recoverable.');return;
  }
  assert.ok(['backup','verify','restore'].includes(action));assert.equal(args.length,action==='verify'?3:4);
  const key=loadKey(keyFile);
  try{
    if(action==='backup'){
      assert.ok(fs.statSync(input).size<=150_000);const inventory=manifest(JSON.parse(fs.readFileSync(input,'utf8')));
      noLinks(output);assert.ok(!fs.existsSync(output),'Never overwrite an existing archive');
      const documents=[];
      try{
        for(const item of inventory.objects){
          const primary=fetchOriginal(`nestwise-documents-${inventory.environment}`,item);
          const backup=fetchOriginal(`nestwise-documents-${inventory.environment}-backup`,item);
          assert.ok(primary.equals(backup),'The two object copies differ');backup.fill(0);documents.push(primary);
        }
        const archive=seal(inventory,documents,key);const verified=open(archive,key);
        for(const bytes of verified.documents)bytes.fill(0);
        fs.writeFileSync(output,archive,{flag:'wx',mode:0o600});
        console.log(JSON.stringify({objects:documents.length,archiveSha256:hash(archive),encrypted:true,bothCloudCopiesVerified:true}));
      }finally{for(const bytes of documents)bytes.fill(0);}
    }else{
      assert.ok(fs.statSync(input).size<=MAX_ARCHIVE);const archive=fs.readFileSync(input);
      if(action==='restore')console.log(`Restored ${restore(archive,key,output)} verified documents to the new directory.`);
      else{const result=open(archive,key);for(const bytes of result.documents)bytes.fill(0);console.log(`Verified ${result.inventory.objects.length} encrypted documents; no plaintext files written.`);}
    }
  }finally{key.fill(0);}
}
module.exports={manifest,seal,open,restore};
if(require.main===module)main(process.argv.slice(2)).catch(()=>{console.error('Document recovery failed. No keys or document contents logged; existing archives were not overwritten.');process.exitCode=1;});
