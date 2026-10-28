import assert from'node:assert/strict';import{compileSource}from'../compile.mjs';import{sourceExpose}from'../source-expose-scan.mjs';
const compile=options=>compileSource(sourceExpose,{allowUnsupported:false,...options});
const on=compile(),off=compile({sourceSpecializations:false}),changed=compileSource(sourceExpose.replace('var keys=','var keys ='),{allowUnsupported:false}),split=compile({largeBody:{minimumNodes:1,maxNodes:20,maxStatements:2,maxInitGroups:1}});
assert.equal(on.manifest.functions.filter(f=>f.sourceSpecialization==='native-expose-scan-v1').length,1);
assert.ok(on.rust.includes('try_native_expose_scan'));assert.deepEqual(on.manifest.functions.find(f=>f.sourceSpecialization).nativeBindings,[]);
for(const result of[off,changed,split])assert.ok(!result.rust.includes('try_native_expose_scan'));
console.log(JSON.stringify({passed:true,cases:5,scope:'Exact source recognition, opt out, altered source, split function exclusion and environment-backed loop values.'}));
