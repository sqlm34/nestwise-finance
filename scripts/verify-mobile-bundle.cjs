const {readdirSync, readFileSync, mkdirSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
function inspectSourceMap(map) {
  if (map?.version !== 3) throw new Error('Invalid source map version');
  if (Array.isArray(map.sections)) {
    if (!map.sections.length) throw new Error('Empty indexed source map');
    return map.sections.flatMap(section => inspectSourceMap(section.map));
  }
  if (!Array.isArray(map.sources) || !map.sources.length || map.sources.some(s => typeof s !== 'string')) throw new Error('Source map has no valid source evidence');
  const forbidden = map.sources.filter(source => /(?:^|\/)node_modules\/(braces|node-forge|uuid)\//.test(source.replace(/\\/g, '/')));
  if (forbidden.length) throw new Error('Reviewed build-tool packages entered a mobile bundle; reassess exposure');
  return map.sources;
}
function verifyDirectory(root) {
  const maps = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.map')) maps.push(path);
    }
  }
  walk(root);
  const evidence = ['android', 'ios'].map(platform => {
    const files = maps.filter(path => path.replace(/\\/g,'/').includes(`/${platform}/`));
    if (!files.length) throw new Error(`No ${platform} source maps found`);
    return {platform, maps: files.length, sources: files.reduce((total,path) => total + inspectSourceMap(JSON.parse(readFileSync(path,'utf8'))).length,0)};
  });
  return {schemaVersion: 1, scope: 'exported mobile JavaScript only; not APK/IPA native binaries', productionApproved: false, evidence};
}
if (require.main === module) {
  try {
    const evidence = verifyDirectory(process.argv[2] ?? 'dist-mobile');
    mkdirSync('.local', {recursive: true});
    writeFileSync('.local/mobile-dependency-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence));
  } catch {
    console.error('Mobile source-map evidence missing, invalid or contains reviewed build-tool dependencies.');
    process.exitCode = 1;
  }
}
module.exports = {inspectSourceMap, verifyDirectory};
