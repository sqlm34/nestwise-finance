const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join,dirname,resolve}=require('node:path');
const {createHash}=require('node:crypto');
const {verifyAndStrip}=require('../scripts/verify-web-bundle.cjs');
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'nestwise-web-maps-'));
  t.after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(root.startsWith(join(tmpdir(),'nestwise-web-maps-')));rmSync(root,{recursive:true,force:true});});
  mkdirSync(join(root,'web'));
  function bundle(name='app',sources=['src/app.ts']){
    const path=join(root,'web',name+'.js');
    writeFileSync(path,`console.log('example');\n//# sourceMappingURL=/web/${name}.js.map\n//# debugId=example\n`);
    writeFileSync(path+'.map',JSON.stringify({version:3,sections:[{map:{version:3,sources}}]}));
    return path;
  }
  return {root,bundle};
}
test('web audit strips maps and references from the actual deployment files and fingerprints their bytes',t=>{
  const {root,bundle}=fixture(t),a=bundle(),b=bundle('lazy');
  const result=verifyAndStrip(root);
  assert.equal(result.maps,2);assert.equal(result.sources,2);assert.equal(result.productionApproved,false);
  for(const path of [a,b]){assert.equal(existsSync(path+'.map'),false);assert.doesNotMatch(readFileSync(path,'utf8'),/sourceMappingURL/);}
  assert.equal(result.bundles[0].sha256,createHash('sha256').update(readFileSync(a)).digest('hex'));
  assert.match(readFileSync(a,'utf8'),/console.log/);
});
test('web audit checks lazy bundles and fails without mutating any files if a forbidden module appears',t=>{
  const {root,bundle}=fixture(t),a=bundle(),b=bundle('lazy',['C:\\project\\node_modules\\node-forge\\lib\\rsa.js']);
  assert.throws(()=>verifyAndStrip(root));
  assert.equal(existsSync(a+'.map'),true);assert.equal(existsSync(b+'.map'),true);
  assert.match(readFileSync(a,'utf8'),/sourceMappingURL/);
});
test('web audit rejects absent, orphan, empty and malformed evidence',t=>{
  const {root,bundle}=fixture(t);
  assert.throws(()=>verifyAndStrip(root));
  const a=bundle();
  writeFileSync(join(root,'extra.js'),'console.log(1)');
  assert.throws(()=>verifyAndStrip(root));
  writeFileSync(join(root,'extra.js.map'),'invalid');
  assert.throws(()=>verifyAndStrip(root));
  writeFileSync(join(root,'extra.js.map'),JSON.stringify({version:3,sources:[]}));
  assert.throws(()=>verifyAndStrip(root));
  assert.equal(existsSync(a+'.map'),true);
});
test('web audit rejects inline map content rather than accidentally publishing sources',t=>{
  const {root,bundle}=fixture(t),a=bundle();
  writeFileSync(a,'console.log(1);\n//# sourceMappingURL=data:application/json;base64,abc\n');
  assert.throws(()=>verifyAndStrip(root));
  assert.equal(existsSync(a+'.map'),true);
});
test('web audit rejects an orphan map even when the map and script counts happen to match',t=>{
  const {root,bundle}=fixture(t),a=bundle();
  rmSync(a+'.map');
  writeFileSync(join(root,'orphan.map'),JSON.stringify({version:3,sources:['src/app.ts']}));
  assert.throws(()=>verifyAndStrip(root));
  assert.match(readFileSync(a,'utf8'),/sourceMappingURL/);
});
