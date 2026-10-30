import assert from'node:assert/strict';import{compileSource}from'./compile.mjs';
const build=(source,options={})=>compileSource(source,{filename:'canonical-small-index-contract.js',staticLiteralStrings:true,numericLiteralKeys:true,...options}).rust;
for(let i=0;i<4;i++){const direct=`Value::String(js_runtime::StringId(${i}))`;assert.ok(build(`var a="${i}";`).includes(direct));assert.ok(build(`var a={};a[${i}];`).includes(direct));assert.ok(!build(`var a="${i}";`,{staticLiteralStrings:false}).includes(direct));assert.ok(build(`var a="${i}";`,{staticLiteralStrings:false}).includes(`rt.string("${i}")`));assert.ok(!build(`var a={};a[${i}];`,{numericLiteralKeys:false}).includes(direct));}
for(const s of['','4','00','01','-0','0.0','03','10','💩','\ud800'])assert.ok(!build(`var a=${JSON.stringify(s)};`).includes('Value::String(js_runtime::StringId('));
assert.ok(build('var a={};a[-0];').includes('Value::String(js_runtime::StringId(0))'));
console.log(JSON.stringify({passed:true,canonicalIds:[0,1,2,3],unsupportedStrings:10,staticOffPreserved:true,numericOffPreserved:true,minusZeroNormalized:true}));
