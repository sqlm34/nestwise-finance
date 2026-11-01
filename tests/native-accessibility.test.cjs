const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const ts=require('typescript');
test('static accessibilityRole values are supported by the installed Android native runtime',()=>{
 const native=readFileSync('node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.kt','utf8');
 const declaration=native.match(/enum class AccessibilityRole\s*\{([^;]+);/);assert.ok(declaration);
 const allowed=new Set(declaration[1].split(',').map(s=>s.trim().toLowerCase()));assert.ok(allowed.has('button')&&allowed.has('text'));
 let checked=0;
 function visitDirectory(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);if(entry.isDirectory()){visitDirectory(path);continue;}if(!path.endsWith('.tsx'))continue;
  const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function visit(node){if(ts.isJsxAttribute(node)&&node.name.getText(source)==='accessibilityRole'&&node.initializer&&ts.isStringLiteral(node.initializer)){
   checked++;assert.ok(allowed.has(node.initializer.text),`${path}: Android rejects accessibilityRole=${node.initializer.text}`);
  }ts.forEachChild(node,visit);}visit(source);
 }}visitDirectory('src');assert.ok(checked>10);
});
