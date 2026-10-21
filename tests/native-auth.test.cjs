const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerHooks}=require('node:module');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');

test('native client retains server-prefixed cookie and authenticates the next account request',async()=>{
  // Only platform bindings are mocked. Cookie filtering/storage uses the installed
  // Expo auth plugin, and login/session validation uses the real Better Auth server.
  const mocks={
    'react-native':"export const Platform={OS:'android'}; export const AppState={currentState:'active',addEventListener(){return {remove(){}}}};",
    'expo-constants':"export default {expoConfig:{scheme:'nestwise-development'}};",
    'expo-linking':"export const createURL=(_,o)=>o.scheme+'://';",
  };
  const hooks=registerHooks({resolve(specifier,context,next){return Object.hasOwn(mocks,specifier)
    ?{url:'data:text/javascript,'+encodeURIComponent(mocks[specifier]),shortCircuit:true}:next(specifier,context);}});
  let fixture;
  try{
    const expo=await import('@better-auth/expo/client');
    fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();
    const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),
      getItemAsync:async k=>values.get(k)??null,setItemAsync:async(k,v)=>{values.set(k,v);}};
    let plugin;
    const exports={};
    const source=ts.transpileModule(readFileSync('src/auth/client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(source,{exports,process:{env:{EXPO_PUBLIC_API_URL:'http://localhost:8083'}},__DEV__:true,URL,
      fetch:(url,options)=>fixture.fetch(new Request(url,options)),
      require(name){
        if(name==='better-auth/react')return {createAuthClient(options){plugin=options.plugins[0];return plugin.getActions(null,{notify(){},atoms:{}});}};
        if(name==='@better-auth/expo/client')return expo;
        if(name==='expo-secure-store')return storage;
        if(name==='expo-constants')return {default:{expoConfig:{scheme:'nestwise-development'}}};
        if(name==='react-native')return {Platform:{OS:'android'}};
        throw new Error('Unexpected import '+name);
      }});
    assert.equal((await exports.authenticatedFetch('/v1/session')).status,401);
    const url='http://localhost:8083/api/auth/sign-in/email';
    const body={email:fixture.email,password:fixture.password};
    const prepared=await plugin.fetchPlugins[0].init(url,{method:'POST',body});
    const response=await fixture.fetch(new Request(url,{method:'POST',headers:{'content-type':'application/json',...prepared.options.headers},body:JSON.stringify(body)}));
    assert.equal(response.status,200,await response.clone().text());
    await plugin.fetchPlugins[0].hooks.onSuccess({request:{url,body:JSON.stringify(body)},response,data:await response.json()});
    const cookie=await exports.authClient.getCookie();
    assert.match(cookie,/nestwise\.session_token=/);
    const session=await exports.authenticatedFetch('/v1/session');
    assert.equal(session.status,200);
    assert.equal((await session.json()).workspaces[0].id,fixture.workspace);
    assert.ok(values.has('nestwise-auth_cookie'));
    // Sign-out must also clear the native jar; a cached cookie is not authorization.
    const signout=await plugin.fetchPlugins[0].init('http://localhost:8083/api/auth/sign-out',{method:'POST',body:{}});
    const loggedOut=await fixture.fetch(new Request('http://localhost:8083/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json',...signout.options.headers},body:'{}'}));
    assert.equal(loggedOut.status,200);
    await plugin.fetchPlugins[0].hooks.onSuccess({request:{url:'http://localhost:8083/api/auth/sign-out'},response:loggedOut,data:await loggedOut.json()});
    assert.equal(await exports.authClient.getCookie(),'');
    assert.equal((await exports.authenticatedFetch('/v1/session')).status,401);
  }finally{await fixture?.db.close();hooks.deregister();}
});
