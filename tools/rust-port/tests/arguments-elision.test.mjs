import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from '../compile.mjs';
// Isolate the original eager/lazy and context-mask policy from the additional
// immutable-parameter lowering, which has its own execution/eligibility gate.
const compile=source=>compileSource(source,{mode:'function',allowUnsupported:false,nativeParameters:false});
const count=source=>(compile(source).rust.match(/rt\.arguments_object\(/g)??[]).length;
test('only strict unused implicit arguments may be omitted',()=>{
 assert.equal(count('function(a){"use strict";return a+1;}'),0);
 assert.equal(count('function(a){return a+1;}'),0);
 assert.match(compile('function(a){return a+1;}').rust,/rt\.register_lazy_arguments\(env, &\["a"\], args, &\[false\]\)/);
 assert.doesNotMatch(compile('function(a){"use strict";return a+1;}').rust,/register_lazy_arguments/);
 assert.equal(count('function(a){"use strict";return arguments[0];}'),1);
 assert.match(compile('function f(a){a=2;return f.arguments[0];}').rust,/register_lazy_arguments/);
 assert.equal(count('function(a){"use strict";return (()=>arguments[0])();}'),1);
 assert.equal(count('function(a){"use strict";return function(){return arguments[0];};}'),1);
 assert.equal(count('function(a){"use strict";return function(){return ()=>arguments[0];};}'),1);
 assert.equal(count('function(a){"use strict";return ({[arguments[0]](){return 1;}});}'),1);
});
test('eval references conservatively retain arguments even in nested normal functions',()=>{
 assert.equal(count('function(){"use strict";return eval;}'),1);
 assert.equal(count('function(){"use strict";return function(){return eval;};}'),2);
});
test('non-simple defaults remain fail-closed rather than bypassing initialization',()=>{
 assert.throws(()=>compile('function(a=arguments[0]){return a;}'),/Non-simple parameter/);
});

test('capture masks follow parameter bindings across shadows and nested writes',()=>{
 assert.match(compile('function(a,b){var f=()=>a;return b;}').rust,/register_lazy_arguments\(env, &\["a","b"\], args, &\[true,false\]/);
 assert.match(compile('function(a){return function(a){return a;};}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[false\]/);
 assert.match(compile('function(a){return function(){a=2;};}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[true\]/);
 assert.match(compile('function(a){try{throw 1;}catch(a){return ()=>a;}}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[false\]/);
 assert.match(compile('function(a){for(let a=0;a<1;a++){var f=()=>a;}return 1;}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[false\]/);
});
test('legacy snapshot masks distinguish eager policy from actual source context',()=>{
 assert.match(compile('function f(a){var e=eval;a=2;return f.arguments[0];}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[false\]/);
 assert.match(compile('function f(a){function g(){eval("");}a=2;return f.arguments[0];}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[true\]/);
 assert.match(compile('function f(a){function a(){}return f.arguments[0];}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[false\]/);
 assert.match(compile('function f(arguments){arguments=2;return f.arguments[0];}').rust,/register_lazy_arguments\(env, &\["arguments"\], args, &\[false\]/);
 assert.match(compile('function f(a){var arguments=0;return f.arguments[0];}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[true\]/);
 assert.match(compile('function f(a){var o={[a](){return 1;}};return f.arguments[0];}').rust,/register_lazy_arguments\(env, &\["a"\], args, &\[false\]/);
});
