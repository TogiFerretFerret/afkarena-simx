import test from 'node:test';
import assert from 'node:assert/strict';
import {compileSource} from '../compile.mjs';
const compile=source=>compileSource(source,{mode:'function',allowUnsupported:false});
const count=source=>(compile(source).rust.match(/rt\.arguments_object\(/g)??[]).length;
test('only strict unused implicit arguments may be omitted',()=>{
 assert.equal(count('function(a){"use strict";return a+1;}'),0);
 assert.equal(count('function(a){return a+1;}'),1);
 assert.equal(count('function(a){"use strict";return arguments[0];}'),1);
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
