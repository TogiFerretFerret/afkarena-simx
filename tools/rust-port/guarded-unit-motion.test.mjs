import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileSource} from './compile.mjs';
const pin=JSON.parse(readFileSync(new URL('../../config/unit-translation.json',import.meta.url)));
const source=readFileSync(new URL('../../'+pin.source,import.meta.url),'utf8').slice(pin.start,pin.end);
const calls=result=>(result.rust.match(/try_unit_motion_axis/g)??[]).length;
test('only exact original Unit.update body receives two guarded axis hooks',()=>{
 assert.equal(calls(compileSource(source,{mode:'function',guardedUnitMotion:true})),2);
 assert.equal(calls(compileSource(source.replace('this.position[0]+=m[0]*r','this.position[0]+=m[0]*r+0'),{mode:'function',guardedUnitMotion:true})),0);
});
test('default, specialization optout, and nonnative-local configurations retain source',()=>{
 for(const options of [{},{guardedUnitMotion:true,sourceSpecializations:false},{guardedUnitMotion:true,nativeLocalBindings:false}])assert.equal(calls(compileSource(source,{mode:'function',...options})),0);
});
test('the original expression remains in a fallback and arithmetic never becomes fused',()=>{
 const result=compileSource(source,{mode:'function',guardedUnitMotion:true});
 assert.match(result.rust,/if let Some\(value\) = rt.try_unit_motion_axis/);
 assert.match(result.rust,/numeric_arithmetic::mul/);assert.match(result.rust,/numeric_arithmetic::add/);
 assert.doesNotMatch(result.rust,/mul_add/);
});
