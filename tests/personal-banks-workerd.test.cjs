const {test}=require('node:test');const assert=require('node:assert/strict');
const {build}=require('esbuild');const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
test('Plaid requests work in Workers and never forward credentials through redirects',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
 import {requestBankPage} from './worker/personal-banks.ts';
 export default {async fetch(){
  const env={PLAID_ENVIRONMENT:'sandbox',PLAID_CLIENT_ID:'synthetic',PLAID_SECRET:'synthetic'},connection={feed:'synthetic',account_id:'synthetic',access_token:'synthetic'};
  let calls=0;const page={added:[],modified:[],removed:[],next_cursor:'next',has_more:false};
  const success=await requestBankPage(env,connection,'prior',async(url,init)=>{calls++;const request=new Request(url,init);if(request.redirect!=='manual')throw Error('unsafe redirect');return Response.json(page);});
  let rejected=false;
  try{await requestBankPage(env,connection,'prior',async(url,init)=>{calls++;new Request(url,init);return new Response(null,{status:307,headers:{location:'https://untrusted.invalid'}});});}catch(error){rejected=error.message==='bank_feed_redirect';}
  return Response.json({success,rejected,calls});
 }};`},bundle:true,write:false,format:'esm',platform:'browser'});
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-20',script:bundle.outputFiles[0].text}));
 try{const result=await (await runtime.dispatchFetch('http://localhost')).json();assert.equal(result.success.next_cursor,'next');assert.equal(result.rejected,true);assert.equal(result.calls,2);}finally{await runtime.dispose();}
});
