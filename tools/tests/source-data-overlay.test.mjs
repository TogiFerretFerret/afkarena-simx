import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext,runInContext } from 'node:vm';

async function sourceRealm(){
  const source=await readFile(new URL('../../src/srcmodule/game_util.js',import.meta.url),'utf8');
  const copyStart=source.indexOf('ed.copyObj=function('),copyEnd=source.indexOf(',ed.wrapTable=',copyStart);
  const dataStart=source.indexOf('var readonlyArrayProto=[]'),dataEnd=source.indexOf(',ed.addObjectProperty=',dataStart);
  assert.ok(copyStart>=0&&copyEnd>copyStart&&dataStart>=0&&dataEnd>dataStart);
  const context=createContext({});
  runInContext(`var ed={BATTLECHECK:false},cc={game:{src_publish:false}};${source.slice(copyStart,copyEnd)};ed.swallowCopyObject=function(e){return ed.copyObj(e)};${source.slice(dataStart,dataEnd)};`,context);
  return context;
}
test('source overlay copies aliases separately and only top-level arrays reject mutators',async()=>{
  const c=await sourceRealm();
  const result=runInContext(`(function(){var nested=[1],input={A:[nested],B:[nested]},x=ed.createDataObj(input),y=ed.createDataObj(input),threw=false;try{x.A.push(2)}catch(e){threw=true}x.A[0].push(9);return JSON.stringify({threw:threw,alias:x.A[0]===x.B[0],instanceAlias:x.A===y.A,nested:x.A[0],other:x.B[0],fresh:y.A[0],input:input.A[0]});})()`,c);
  assert.deepEqual(JSON.parse(result),{threw:true,alias:false,instanceAlias:false,nested:[1,9],other:[1],fresh:[1],input:[1]});
});
test('source recover(0) means latest entry and retains undefined properties',async()=>{
  const c=await sourceRealm();
  const result=runInContext(`(function(){var x=ed.createDataObj({A:1}),first={A:2},second={B:3};var a=x.wrapTable(first),b=x.wrapTable(second);var same=x.wrap_stack[0].o===first;x.recover(0);return JSON.stringify({a:a,b:b,same:same,A:x.A,B:x.B,ownB:Object.prototype.hasOwnProperty.call(x,'B'),depth:x.wrap_stack.length});})()`,c);
  assert.deepEqual(JSON.parse(result),{a:0,b:1,same:true,A:2,ownB:true,depth:1});
});
test('source recover stops at lock and preserves newer already recovered entries',async()=>{
  const c=await sourceRealm();
  const result=runInContext(`(function(){var x=ed.createDataObj({A:1});x.wrapTable({A:2});x.wrapTable({A:3},true);x.wrapTable({A:4});x.recover(-0.5);return JSON.stringify({A:x.A,depth:x.wrap_stack.length});})()`,c);
  // A negative index is rejected before traversal, even though it is truthy.
  assert.deepEqual(JSON.parse(result),{A:4,depth:3});
  const recovered=runInContext(`(function(){var x=ed.createDataObj({A:1});x.wrapTable({A:2});x.wrapTable({A:3},true);x.wrapTable({A:4});x.recover('0');return JSON.stringify({A:x.A,depth:x.wrap_stack.length});})()`,c);
  assert.deepEqual(JSON.parse(recovered),{A:3,depth:2});
});
