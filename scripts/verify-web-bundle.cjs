// Audit the same web export that will be deployed, then remove source maps.
const {readdirSync,readFileSync,writeFileSync,unlinkSync,mkdirSync,lstatSync}=require('node:fs');
const {resolve,relative,isAbsolute}=require('node:path');
const {createHash}=require('node:crypto');
const {inspectSourceMap}=require('./verify-mobile-bundle.cjs');

function verifyAndStrip(root){
  root=resolve(root);
  if(lstatSync(root).isSymbolicLink())throw new Error('Export root must not be a symlink');
  const files=[];
  function walk(dir){
    for(const entry of readdirSync(dir,{withFileTypes:true})){
      const path=resolve(dir,entry.name),within=relative(root,path);
      if(within.startsWith('..')||isAbsolute(within)||entry.isSymbolicLink())throw new Error('Export contains an unsafe path');
      if(entry.isDirectory())walk(path);else if(entry.isFile())files.push(path);
    }
  }
  walk(root);
  const bundles=files.filter(path=>path.endsWith('.js'));
  const maps=files.filter(path=>path.endsWith('.map'));
  if(!bundles.length||maps.length!==bundles.length)throw new Error('Every web JavaScript bundle requires a source map');
  // Validate everything before removing any source evidence or rewriting a bundle.
  const checked=bundles.map(path=>{
    const mapPath=path+'.map';
    if(!maps.includes(mapPath))throw new Error('Web bundle has no matching map');
    const sources=inspectSourceMap(JSON.parse(readFileSync(mapPath,'utf8')));
    const original=readFileSync(path,'utf8');
    if(/sourceMappingURL\s*=\s*data:/i.test(original))throw new Error('Inline source maps are not deployable');
    const code=original.replace(/^\/\/[#@]\s*sourceMappingURL=[^\r\n]*(?:\r?\n|$)/gm,'');
    if(/sourceMappingURL\s*=/.test(code))throw new Error('Unexpected source map reference');
    return {path,mapPath,code,sources:sources.length};
  });
  for(const row of checked){
    writeFileSync(row.path,row.code);
    unlinkSync(row.mapPath);
  }
  return {schemaVersion:1,scope:'exported web JavaScript only',productionApproved:false,maps:checked.length,
    sources:checked.reduce((sum,row)=>sum+row.sources,0),sourceMapsRemoved:true,
    bundles:checked.map(row=>({file:relative(root,row.path).replace(/\\/g,'/'),sha256:createHash('sha256').update(row.code).digest('hex')}))};
}
if(require.main===module){
  try{
    const evidence=verifyAndStrip(process.argv[2]??'dist');
    mkdirSync('.local',{recursive:true});
    writeFileSync('.local/web-dependency-evidence.json',JSON.stringify(evidence,null,2)+'\n');
    console.log(`Web boundary verified: ${evidence.maps} bundles, ${evidence.sources} source entries; maps removed before publication.`);
  }catch{
    console.error('Web dependency boundary failed: missing/invalid map, unsafe path or build-tool dependency. Do not deploy this export.');
    process.exitCode=1;
  }
}
module.exports={verifyAndStrip};
