import test from 'node:test';
import assert from 'node:assert/strict';
import {createBootstrapRuntime} from '../bootstrap-runtime.mjs';
test('original HFP equal-heal choice observes numeric Cocos-ID key order',async()=>{
 const runtime=await createBootstrapRuntime(),HFP=runtime.context.HFP;
 function run(firstId,secondId){
  const first=runtime.importValue({heal:10,buff:{timer:3,isRemoved:false}}),second=runtime.importValue({heal:10,buff:{timer:3,isRemoved:false}});
  const owner=runtime.importValue({attribs:{HP:100},actor:null});owner.HFPBeaconList=runtime.importValue([]);
  owner.HFPBeaconList[firstId]=first;owner.HFPBeaconList[secondId]=second;
  let healed=0;owner.takeHeal=amount=>{healed+=amount};
  const buff=runtime.importValue({relatedSkill:{info:{}}});buff.owner=owner;buff.relatedSkill.info[HFP.atk3_triggerHpCoef]=.2;
  const damage=HFP.atk3MonitorBuff_onFinalDamaged(()=>100,buff);
  runtime.callbacks.drainCallbacks();
  return{selected:first.buff.timer===-1?'first':second.buff.timer===-1?'second':'none',damage,healed,sparseLength:owner.HFPBeaconList.length};
 }
 const original=run(10,20),renamed=run(20,10),monotone=run(100,5000);
 assert.equal(original.selected,'first');assert.equal(renamed.selected,'second','arbitrary identity renaming changes which source buff is consumed');
 assert.equal(monotone.selected,'first');assert.equal(original.damage,0);assert.equal(original.healed,10);
 assert.equal(original.sparseLength,21);assert.equal(monotone.sparseLength,5001,'even order-preserving renaming changes full mutable array state');
});
