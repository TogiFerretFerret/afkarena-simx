import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNestedCopyWindow as parse} from '../nested-copy-window.mjs';
test('startup hits cannot masquerade as measured admissions',()=>{
 const r=parse('NESTED_COPY_WINDOW:300:200:500:0:true:true');
 assert.equal(r.startupHits,200);assert.equal(r.hits,0);
 assert.equal(r.status,'unexercised');assert.equal(r.eligibleForPerformanceCredit,false);
});
test('only enabled positive measured hits receive credit',()=>{
 assert.equal(parse('NESTED_COPY_WINDOW:300:200:500:40:true:true').eligibleForPerformanceCredit,true);
 assert.equal(parse('NESTED_COPY_WINDOW:300:200:500:40:true:false').eligibleForPerformanceCredit,false);
 assert.equal(parse('NESTED_COPY_WINDOW:0:0:0:0:false:false').status,'disabled');
});
test('old binaries are explicitly unmeasured; new runs can require markers',()=>{
 assert.equal(parse('old diagnostics'),null);
 assert.throws(()=>parse('old diagnostics',{required:true}),/Missing/);
});
test('invalid or duplicated observations cannot qualify',()=>{
 for(const s of ['NESTED_COPY_WINDOW:0:0:0:1:true:true','NESTED_COPY_WINDOW:0:1:2:1:true:true','NESTED_COPY_WINDOW:0:0:9007199254740992:1:true:true','NESTED_COPY_WINDOW:broken','NESTED_COPY_WINDOW:0:0:1:1:true:true\nNESTED_COPY_WINDOW:0:0:1:1:true:true'])assert.throws(()=>parse(s));
});
