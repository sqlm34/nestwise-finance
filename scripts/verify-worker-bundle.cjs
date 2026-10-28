// The listed advisories affect build tooling. Fail if those packages enter the
// request-handling Worker; this is a reachability guard, not an audit waiver.
const {readFileSync}=require('node:fs');
const assert=require('node:assert/strict');
const meta=JSON.parse(readFileSync(process.argv[2]??'.local/worker-audit/meta.json','utf8'));
const inputs=Object.keys(meta.inputs??{});
assert.ok(inputs.length>0,'Expected esbuild input metadata');
const unexpected=inputs.filter(path=>/node_modules[\\/](braces|node-forge|uuid|deepmerge)[\\/]/.test(path));
assert.deepEqual(unexpected,[],'Reviewed build-only advisory packages entered the Worker; reassess before deployment');
console.log(`Worker dependency boundary verified across ${inputs.length} inputs.`);
