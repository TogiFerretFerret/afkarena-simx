import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext,runInContext } from 'node:vm';
import { resolve } from 'node:path';
import { loadNativeTraceSources,installNativeReferenceTrace } from '../native-oracle-trace.mjs';
import { comparePortableBattleTraces } from '../battle-trace-portable.mjs';

test('native reference adapter exports matching completed ordered graph traces across fresh realms',async()=>{
  const sources=await loadNativeTraceSources(resolve(import.meta.dirname,'../..'));
  function run(){
    const context=createContext({});
    runInContext(`var random_seed=1;var ed={clientCall_list:[],clientCallCount:0,battleEngine:{ticks:0,running:true},Unit:function Unit(){},rand:function(){return ++random_seed;},srand:function(seed){random_seed=seed;}};function clientCall(fn){ed.clientCall_list.push(fn);}var scene={snapshot:function(callback){}};`,context);
    const runtime={context,ed:context.ed,callbacks:{sceneHost:context.scene},sourceRecords:{definitions:new Map(),globals:new Map()},host:{}};
    const observer={current:null};
    const trace=installNativeReferenceTrace(runtime,sources,{clockObserver:observer});
    assert.equal(typeof observer.current,'function');
    context.ed.srand(42);trace.beginFrame();context.ed.rand();trace.endFrame();
    const result=trace.stop({status:'completed',running:false,ticks:1,result:'victory'});
    assert.equal(observer.current,null);
    return result;
  }
  const left=run(),right=run();
  assert.equal(comparePortableBattleTraces(left,right).passed,true);
  assert.ok(left.events.some(event=>event.kind==='rng:draw:after'));
});
