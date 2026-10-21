const {test}=require('node:test');
const assert=require('node:assert/strict');
const {registerHooks}=require('node:module');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {randomUUID}=require('node:crypto');

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
    let exports={};
    const source=ts.transpileModule(readFileSync('src/auth/client.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const loadClient=()=>vm.runInNewContext(source,{exports,process:{env:{EXPO_PUBLIC_API_URL:'http://localhost:8083'}},__DEV__:true,URL,
      fetch:(url,options)=>fixture.fetch(new Request(url,options)),
      require(name){
        if(name==='better-auth/react')return {createAuthClient(options){plugin=options.plugins[0];return plugin.getActions(null,{notify(){},atoms:{}});}};
        if(name==='@better-auth/expo/client')return expo;
        if(name==='expo-secure-store')return storage;
        if(name==='expo-constants')return {default:{expoConfig:{scheme:'nestwise-development'}}};
        if(name==='react-native')return {Platform:{OS:'android'}};
        throw new Error('Unexpected import '+name);
      }});
    loadClient();
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
    // A new client instance must restore its cookie solely from persistent storage.
    exports={};loadClient();
    assert.equal((await exports.authenticatedFetch('/v1/session')).status,200);
    const base=`/v1/user/workspaces/${fixture.workspace}/accounts/${fixture.account}`;
    const operation={id:randomUUID(),kind:'income',paid_on:'2026-10-20',amount_cents:'1000',note:'Synthetic native session proof',destination_account:null,reference_operation:null,allocations:[{category:'other_income',cents:'1000'}]};
    // Exercise the actual native POST wrapper, including its Expo-Origin header.
    for(let i=0;i<2;i++){
      const posted=await exports.authenticatedPost(base+'/operations',operation);
      assert.equal(posted.status,200,await posted.clone().text());
    }
    const journal=await (await exports.authenticatedFetch(base+'/journal')).json();
    assert.equal(journal.entries.length,1);
    // Sign-out must also clear the native jar; a cached cookie is not authorization.
    const signout=await plugin.fetchPlugins[0].init('http://localhost:8083/api/auth/sign-out',{method:'POST',body:{}});
    const loggedOut=await fixture.fetch(new Request('http://localhost:8083/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json',...signout.options.headers},body:'{}'}));
    assert.equal(loggedOut.status,200);
    await plugin.fetchPlugins[0].hooks.onSuccess({request:{url:'http://localhost:8083/api/auth/sign-out'},response:loggedOut,data:await loggedOut.json()});
    assert.equal(await exports.authClient.getCookie(),'');
    assert.equal((await exports.authenticatedFetch('/v1/session')).status,401);
    // Without a native cookie the wrapper also omits Expo-Origin; writes fail
    // at the origin boundary before account authorization is considered.
    assert.equal((await exports.authenticatedPost(base+'/operations',{...operation,id:randomUUID()})).status,403);
    assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1);
  }finally{await fixture?.db.close();hooks.deregister();}
});
