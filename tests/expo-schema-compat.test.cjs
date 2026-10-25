const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {join,dirname}=require('node:path');
const root=dirname(require.resolve('@expo/cli/package.json'));
const cliRequire=createRequire(join(root,'package.json'));
const {PluginSchema,DevToolsPluginOutputSchema}=require(join(root,'build/src/start/server/DevToolsPlugin.schema.js'));
const {createMCPDevToolsExtensionSchema}=require(join(root,'build/src/start/server/createMCPDevToolsExtensionSchema.js'));

test('patched Zod preserves Expo CLI plugin validation and MCP command schemas',()=>{
  assert.equal(cliRequire('zod/package.json').version,'4.6.7');
  const plugin={packageName:'synthetic-plugin',packageRoot:'/synthetic',cliExtensions:{description:'test',entryPoint:'index.js',commands:[{name:'inspect',title:'Inspect',environments:['cli','mcp'],parameters:[{name:'query',type:'text'},{name:'count',type:'number'},{name:'confirm',type:'confirm'}]}]}};
  assert.deepEqual(PluginSchema.parse(plugin),plugin);
  assert.equal(PluginSchema.safeParse({...plugin,packageName:''}).success,false);
  const schema=createMCPDevToolsExtensionSchema(plugin);
  assert.deepEqual(schema.parse({command:'inspect',query:'test',count:2,confirm:false}),{command:'inspect',query:'test',count:2,confirm:false});
  for(const invalid of [{command:'unknown'},{command:'inspect',count:'2'},{command:'inspect',extra:true}])assert.equal(schema.safeParse(invalid).success,false);
  assert.throws(()=>createMCPDevToolsExtensionSchema({packageName:'empty'}));
  assert.equal(DevToolsPluginOutputSchema.safeParse([{type:'text',text:'test',level:'info'},{type:'image',url:'https://example.test/image.png'}]).success,true);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{type:'image',url:'invalid'}]).success,false);
});
