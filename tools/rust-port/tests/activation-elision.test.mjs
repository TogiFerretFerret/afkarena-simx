import assert from 'node:assert/strict';
import {compileSource} from '../compile.mjs';
const first=(source,options={})=>compileSource(source,{mode:'function',allowUnsupported:false,...options}).manifest.functions[0];
const cases=[
 ['function(){return 1;}',true],
 ['function(e){var x=e;return x+e;}',true],
 ['function(e){e++;return e;}',false],
 ['function(e){return arguments[0];}',false],
 ['function(){return arguments.length;}',false],
 ['function(e){if(false)eval("e");return e;}',false],
 ['function(e){{let x=e;}return e;}',false],
 ['function(e){for(let x=0;x<e;x++){}return e;}',false],
 ['function(e){try{}catch(x){}return e;}',false],
 ['function(e){return function(){return 1;};}',false],
 ['function(e){return ()=>e;}',false],
 ['function named(e){return e;}',false],
 ['function(e,e){return e;}',false],
 ['function(e){var e=2;return e;}',false],
 ['function(e){function child(){}return e;}',false],
];
for(const[source,expected]of cases)assert.equal(first(source).nativeActivationElided,expected,source);
assert.equal(first('function(e){return e;}',{nativeLocalBindings:false}).nativeActivationElided,false);
assert.equal(first('function(e){return e;}',{largeBody:{minimumNodes:1}}).nativeActivationElided,false);
assert.match(compileSource('function(e){return e;}',{mode:'function',allowUnsupported:false,largeBody:{minimumNodes:1,maxInitGroups:1}}).rust,/register_lazy_arguments\(env, &\["e"\], args, &\[false\]\)/);
assert.equal(compileSource('var e=1;e++;',{allowUnsupported:false}).manifest.functions[0].nativeActivationElided,false);
console.log(JSON.stringify({passed:true,cases:cases.length+4,scope:'Independent zero-cell activation elision eligibility; execution parity is checked by arguments and closure gates.'}));
