const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {buildSync}=require('esbuild');
const source=buildSync({entryPoints:['src/foreground-refresh.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['react-native']}).outputFiles[0].text;
function fixture(os){
 const listeners=new Map();let tick,cleared=false,removed=false;
 const app={currentState:'active',addEventListener:(_name,fn)=>{listeners.set('app',fn);return {remove(){removed=true;listeners.delete('app');}};}};
 const document={visibilityState:'visible',addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const window={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports,require:()=>({AppState:app,Platform:{OS:os}}),document,window,setInterval:(fn,ms)=>{assert.equal(ms,5000);tick=fn;return 1;},clearInterval:()=>{cleared=true;}});
 return {api:module.exports,app,document,listeners,tick:()=>tick(),clean:()=>cleared&&(os==='web'?listeners.size===0:removed)};
}
test('Android refresh pauses in background and resumes immediately; cleanup removes timer/listener',()=>{
 const f=fixture('android');let count=0;const stop=f.api.onForegroundRefresh(()=>count++);
 f.tick();assert.equal(count,1);f.app.currentState='background';f.tick();assert.equal(count,1);
 f.app.currentState='active';f.listeners.get('app')();assert.equal(count,2);stop();assert.ok(f.clean());
});
test('web refresh pauses in hidden tabs and reconnect/visibility resumes it without a page reload',()=>{
 const f=fixture('web');let count=0;const stop=f.api.onForegroundRefresh(()=>count++);
 f.document.visibilityState='hidden';f.tick();assert.equal(count,0);f.document.visibilityState='visible';f.listeners.get('visibilitychange')();f.listeners.get('online')();assert.equal(count,2);stop();assert.ok(f.clean());
});
