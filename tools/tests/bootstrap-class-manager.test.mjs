import test from 'node:test';
import assert from 'node:assert/strict';
import {runInContext} from 'node:vm';
import {createBootstrapRuntime} from '../bootstrap-runtime.mjs';

// Execute the actual eager module, rather than a miniature vendor-only fixture.
// Compare two independent, identically seeded realms to expose instrumentation
// that accidentally consumes an ID, an entropy draw, or an extra constructor.
test('eager source boot preserves allocator history with hidden-counter observation',async()=>{
 const samples=[];
 for(const observeClassManager of [false,true]){
  let entropyDraws=0;
  const runtime=await createBootstrapRuntime({eagerBattle:true,observeClassManager,hostRandom(){entropyDraws++;return .125;}});
  const observer=runtime.classManagerObserver;
  const before=observer?.snapshot();
  if(observer){
   assert.ok(before.classCalls>0,'whole battle classes pass through the observer');
   assert.equal(observer.snapshot().classCalls,before.classCalls,'snapshots allocate no class IDs');
   assert.equal(observer.snapshot().instanceCalls,before.instanceCalls,'snapshots allocate no instance IDs');
   assert.ok(runtime.sourceRecords.hostSources.some(record=>record.file==='tools/oracle-class-manager.js'&&record.phase==='after-cocos-before-render'));
  }
  const sample=runInContext(`(function(){
   var ctorCalls=0;
   var Probe=cc.Class.extend({ctor:function(){ctorCalls++;this.payload=17;}});
   var first=new Probe(),second=new Probe();
   return {classIds:[ed.Entity.prototype.__pid,ed.Unit.prototype.__pid,ed.Skill.prototype.__pid,Probe.prototype.__pid],instanceIds:[first.__instanceId,second.__instanceId],ctorCalls:ctorCalls,payloads:[first.payload,second.payload],nextClassId:classManager.getNewID(),nextInstanceId:classManager.getNewInstanceId()};
  })()`,runtime.context);
  if(observer){
   const after=observer.finish();
   assert.equal(sample.classIds[3],before.nextClassId);
   assert.equal(sample.instanceIds[0],before.nextInstanceId);
   assert.equal(after.classCalls,before.classCalls+2);
   assert.equal(after.instanceCalls,before.instanceCalls+3);
   assert.equal(after.lastClassId,sample.nextClassId);
   assert.equal(after.lastInstanceId,sample.nextInstanceId);
   assert.equal(after.nextClassId,sample.nextClassId+1);
   assert.equal(after.nextInstanceId,sample.nextInstanceId+1);
  }
  assert.equal(entropyDraws,2,'only the two original vendor counter seeds consume entropy');
  assert.equal(sample.ctorCalls,2);
  samples.push(JSON.parse(JSON.stringify(sample)));
 }
 assert.deepEqual(samples[1],samples[0]);
});
