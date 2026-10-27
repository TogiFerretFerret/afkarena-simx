import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { instrumentRng, bits, compareTrace, parseTraceLine } from '../rng-trace.mjs';

const event=(kind,value=1)=>({kind,value:bits(value),state:bits(2),initial:bits(3)});

test('trace comparison detects order, missing events, writes and signed-zero differences',()=>{
  const expected=[event('write'),event('return')];
  assert.equal(compareTrace(expected,[...expected].reverse()).match,false);
  assert.equal(compareTrace(expected,expected.slice(1)).reason,'event_count');
  assert.equal(compareTrace(expected,[{...expected[0],state:bits(4)},expected[1]]).field,'state');
  assert.equal(compareTrace([event('return',-0)],[event('return',0)]).match,false);
  assert.equal(compareTrace(expected,expected).match,true);
});

test('NaN payload differences fail by default and require an explicit semantic policy',()=>{
  const a={...event('return'),value:'7ff8000000000001'};
  const b={...a,value:'fff8000000000002'};
  assert.equal(compareTrace([a],[b]).match,false);
  assert.deepEqual(compareTrace([a],[b],{nanPolicy:'semantic'}),{match:true,nanBitDifferences:1});
  assert.throws(()=>parseTraceLine('return:no-bits:0000000000000000:-'));
});

test('instrumentation preserves original return values, final state and log strings',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../config/rng-translation.json',import.meta.url),'utf8'));
  const source=await readFile(new URL(`../../${manifest.source}`,import.meta.url),'utf8');
  function setup(instrumented){
    const logs=[];
    const context=createContext({ed:{btLog:{append:s=>logs.push(s)}},cc:{error:s=>logs.push(s)},__traceValue:(_kind,value)=>value});
    runInContext('var random_seed=1,multiplier=25,moder=Math.pow(2,35)-31;',context);
    for(const fn of manifest.functions){
      const code=source.slice(fn.start,fn.end);
      runInContext(`${fn.name}=${instrumented?instrumentRng(code,fn.name):`(${code})`};`,context);
    }
    return {context,logs};
  }
  const plain=setup(false),traced=setup(true);
  for(const seed of [0,-0,NaN,Infinity,-Infinity,Number.MIN_VALUE,-1,.5,1,2026]){
    for(const instance of [plain,traced])instance.context.ed.srand(seed);
    for(let i=0;i<10;i++)for(const name of ['randDontChangeSeed','rand']){
      assert.ok(Object.is(plain.context.ed[name](),traced.context.ed[name]()));
    }
    assert.equal(bits(plain.context.random_seed),bits(traced.context.random_seed));
    assert.equal(bits(plain.context.ed.init_battle_seed),bits(traced.context.ed.init_battle_seed));
  }
  assert.deepEqual(plain.logs,traced.logs);
});
