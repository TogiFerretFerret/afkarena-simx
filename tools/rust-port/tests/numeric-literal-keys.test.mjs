import test from 'node:test';import assert from 'node:assert/strict';import {compileSource} from '../compile.mjs';
const compile=(source,options={})=>compileSource(source,{allowUnsupported:false,...options}).rust;
test('numeric literal keys share static canonical strings for every Reference operation',()=>{
 for(const source of ['o[0]','o[0]=2','o[0]+=2','o[0]++','delete o[0]','o?.[0]','delete o?.[0]'])assert.match(compile(source),/rt\.static_string\("0"\)/,source);
 assert.match(compile('o[-0]'),/rt\.static_string\("0"\)/);
 assert.match(compile('o[1e21]'),/rt\.static_string\("1e\+21"\)/);
 assert.match(compile('o[1e400]'),/rt\.static_string\("Infinity"\)/);
 assert.match(compile('o[-1.5]'),/rt\.static_string\("-1.5"\)/);
});
test('dynamic keys stay on original evaluation path and option disables folding',()=>{
 assert.doesNotMatch(compile('o[0]',{numericLiteralKeys:false}),/static_string\("0"\)/);
 assert.doesNotMatch(compile('o[k]'),/static_string\("0"\)/);
 assert.doesNotMatch(compile('o[1+1]'),/static_string\("2"\)/);
 const output=compile('getBase()[0]=getRhs()');assert.ok(output.indexOf('static_string("0")')<output.indexOf('"getRhs"'));
});
