import test from 'node:test';
import assert from 'node:assert/strict';
import { validateNativeReplayContract,parseNativeReplayCommand } from '../native-replay-contract.mjs';
const root='/repo',fixtureDirectory='/repo/benchmarks/fixtures/example';
function fixture(){
  const metadata={scenario:{file:'/repo/config/scenario.json',sha256:'scenario-sha'},scope:'observed',captureMode:'final',battles:1,warmup:0,initialTrace:true,traceEnabled:true,tableMembraneEnabled:true,trackMutable:true,mutableTables:['AnimAtkFrame','UnitPeriod'],eagerBattle:true,oracleProfile:{node:'v24.19.0',rawBitReferenceFlags:['--jitless']},adapterInputs:{'tools/source.mjs':'source-sha'}};
  const manifest={scenario:{file:'config/scenario.json',sha256:'scenario-sha'},oracleProfile:structuredClone(metadata.oracleProfile),adapterInputs:structuredClone(metadata.adapterInputs),rebuild:{emitter:'node tools/emit-native-oracle.mjs --scenario config/scenario.json --scope observed --capture final --battles 1 --warmup 0 --host-inputs benchmarks/fixtures/example/host-inputs.json.gz --output work/native-oracle-replay.js --trace-initial --mutable-tables AnimAtkFrame,UnitPeriod --tracked-mutable-tables --eager-battle'}};
  return{metadata,manifest};
}
const check=({metadata,manifest})=>validateNativeReplayContract(manifest,metadata,{root,fixtureDirectory});
test('complete replay options preserve the captured source execution contract',()=>{
  assert.deepEqual(check(fixture()),{valid:true,legacyCaptureInferred:false,sourceProfilePinned:true});
});
test('omitted mutable tracking, changed initialization, capture, or scenario fail replay validation',()=>{
  for(const [oldValue,newValue]of[[' --tracked-mutable-tables',''],[' --eager-battle',''],['--trace-initial','--trace'],['--capture final','--capture all'],['config/scenario.json','config/other.json'],['AnimAtkFrame,UnitPeriod','UnitPeriod']]){
    const f=fixture();f.manifest.rebuild.emitter=f.manifest.rebuild.emitter.replace(oldValue,newValue);assert.throws(()=>check(f),/replay options differ/);
  }
});
test('source input and pinned oracle profile mismatches fail independently of matching CLI flags',()=>{
  for(const mutate of[f=>f.manifest.scenario.sha256='wrong',f=>f.manifest.oracleProfile.rawBitReferenceFlags=[],f=>f.manifest.adapterInputs['tools/source.mjs']='wrong']){
    const f=fixture();mutate(f);assert.throws(()=>check(f),/differs/);
  }
});
test('historical missing capture mode uses explicit all capture without inventing a pinned profile',()=>{
  const f=fixture();delete f.metadata.captureMode;delete f.metadata.oracleProfile;delete f.manifest.oracleProfile;
  f.manifest.rebuild.emitter=f.manifest.rebuild.emitter.replace('--capture final','--capture all');
  assert.deepEqual(check(f),{valid:true,legacyCaptureInferred:true,sourceProfilePinned:false});
});
test('duplicate options, missing values and shell syntax are rejected without execution',()=>{
  const base=fixture().manifest.rebuild.emitter;
  for(const command of[base+' --scope observed',base+' --unknown',base+'; touch /tmp/unsafe',base+' $(echo unsafe)'])assert.throws(()=>parseNativeReplayCommand(command));
});
test('nontrace allocator observation must remain enabled in the replay contract',()=>{
  const f=fixture();f.metadata.traceEnabled=false;f.metadata.initialTrace=false;f.metadata.observeClassManager=true;
  f.manifest.rebuild.emitter=f.manifest.rebuild.emitter.replace('--trace-initial','--table-membrane')+' --observe-class-manager';
  assert.equal(check(f).valid,true);
  f.manifest.rebuild.emitter=f.manifest.rebuild.emitter.replace(' --observe-class-manager','');
  assert.throws(()=>check(f),/replay options differ/);
});
