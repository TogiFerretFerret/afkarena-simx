import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {compileNativeUnits} from '../native-compiler-multi.mjs';
test('reject more than eight native units before opening inputs or compiling',async()=>{
  let invoked=false;
  await assert.rejects(compileNativeUnits({root:resolve(import.meta.dirname,'../..'),metadata:{factoryChunks:Array.from({length:8},()=>({file:'/missing/source.js',sha256:'unused'})),outputSha256:'unused'},input:'/missing/main.js',output:'/missing/native',compiler:'/missing/compiler',ccOpt:'O1',binaryPools:true,run:async()=>{invoked=true;throw new Error('must not invoke');},sha:()=>{throw new Error('must not read source');}}),/at most 8 SHUnits/);
  assert.equal(invoked,false);
});
