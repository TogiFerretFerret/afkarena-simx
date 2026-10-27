import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

async function setup(){
  const context=createContext({cc:{game:{config:null,CONFIG_KEY:{}}},HTMLElement:function HTMLElement(){}});context.window=context;
  for(const file of ['bootstrap-host.js','bootstrap-vendor-CCClass.js','bootstrap-vendor-CCTypesPredicates.js','bootstrap-render-host.js'])runInContext(await readFile(new URL(`../${file}`,import.meta.url),'utf8'),context,{filename:file});
  return context;
}
test('stateful device nodes retain identities, hierarchy and independent numeric axes',async()=>{
  const context=await setup();const parent=new context.cc.Node(),child=new context.cc.Node();
  parent.addChild(child);child.setPosition(-0,4);child.setScale(2,3);child.setVisible(false);
  assert.equal(child.getParent(),parent);assert.equal(parent.getChildren()[0],child);
  assert.ok(Object.is(child.getPosition().x,-0));assert.equal(child.getPosition().y,4);
  assert.equal(child.getScaleX(),2);assert.equal(child.getScaleY(),3);assert.equal(child.isVisible(),false);
  child.removeFromParent();assert.equal(child.getParent(),null);assert.equal(parent.getChildren().length,0);
  assert.equal(context.bootstrapHost.snapshotState().render.nodes.length,2);
});
test('source animation metadata is required and unknown geometry/timeline cannot invent values',async()=>{
  const context=await setup();
  assert.throws(()=>context.cc.spriteFrameCache.addSpriteFrames('missing.plist'),/Missing source render sprite atlas frame data: missing.plist/);
  assert.throws(()=>context.sp.SkeletonAnimation.createWithBinaryFile('missing.skel','missing.atlas',1),/Missing source render asset metadata/);
  context.bootstrapHost.render.registerAsset('source.skel',{animations:{atk:{duration:.5}}});
  context.bootstrapHost.render.registerAsset('source.atlas',{});
  const skeleton=context.sp.SkeletonAnimation.createWithBinaryFile('source.skel','source.atlas',1);
  assert.equal(skeleton.setAnimation(0,'atk',false).animation.duration,.5);
  assert.throws(()=>skeleton.setAnimation(0,'unknown',false),/animation duration/);
  assert.throws(()=>skeleton.findBone('unknown'),/bone geometry/);
  assert.throws(()=>skeleton.update(.125),/animation event timeline/);
  assert.throws(()=>skeleton.convertToWorldSpace({x:0,y:0}),/world transform/);
});
function logicalClip(duration,action='atk'){return{duration,logicalTimeline:{kind:'source-table-f64-v1',eventPolicy:'no-observable-events',source:{table:'AnimDuration',key:'fixture.cha',action,sha256:'a'.repeat(64)}}};}
async function logicalSkeleton(){
 const context=await setup();
 context.bootstrapHost.render.registerAsset('logical.skel',{animations:{atk:logicalClip(.25),next:logicalClip(.5,'next'),decimal:logicalClip(.3,'decimal')}});
 context.bootstrapHost.render.registerAsset('logical.atlas',{});
 return{context,skeleton:context.sp.SkeletonAnimation.createWithBinaryFile('logical.skel','logical.atlas',1)};
}
test('opt-in logical f64 timeline preserves completion boundaries, reset and source time scale',async()=>{
 const{skeleton}=await logicalSkeleton(),completed=[];
 skeleton.setCompleteListener(entry=>completed.push(entry.animation.name));
 const first=skeleton.setAnimation(0,'atk',false);skeleton.update(.125);
 assert.equal(first.trackTime,.125);assert.deepEqual(completed,[]);
 skeleton.update(.125);skeleton.update(.125);assert.deepEqual(completed,['atk']);assert.equal(first.trackTime,.375);
 const second=skeleton.setAnimation(0,'atk',false);assert.equal(second.trackTime,0);assert.equal(second.completed,false);
 skeleton.setTimeScale(0);skeleton.update(.125);assert.equal(second.trackTime,0);
 skeleton.setTimeScale(2);skeleton.update(.125);assert.equal(second.trackTime,.25);assert.deepEqual(completed,['atk','atk']);
 const decimal=skeleton.setAnimation(0,'decimal',false);skeleton.setTimeScale(1);for(let i=0;i<3;i++)skeleton.update(.1);
 const bits=Buffer.alloc(8);bits.writeDoubleBE(decimal.trackTime);assert.equal(bits.toString('hex'),'3fd3333333333334');
 skeleton.clearTracks();skeleton.update(.125);assert.equal(Object.keys(skeleton._tracks).length,0);
});
test('logical loops execute every completion and stop stale entry callbacks after action replacement',async()=>{
 const{skeleton}=await logicalSkeleton(),counts=[];
 skeleton.setCompleteListener(entry=>counts.push(entry.completedLoops));
 const entry=skeleton.setAnimation(0,'atk',true);skeleton.update(.625);
 assert.deepEqual(counts,[1,2]);assert.equal(entry.trackTime,.625);
 skeleton.setCompleteListener(()=>skeleton.setAnimation(0,'next',false));
 const replaced=skeleton.setAnimation(0,'atk',true);skeleton.update(.625);
 assert.equal(replaced.completedLoops,1);assert.equal(skeleton._tracks[0].animation.name,'next');assert.equal(skeleton._tracks[0].trackTime,0);
});
test('logical timelines reject unknown event effects, changed event methods and unsupported clocks',async()=>{
 const{context,skeleton}=await logicalSkeleton();skeleton.setAnimation(0,'atk',false);
 const animationEventSource='function(e,t){var i=t.data;i.name,i.intValue,i.intValue,i.stringValue;this._onEvent&&this._onEvent(e,t)}';
 const eventDelegateSource='function(e,t){n.__onAnimationEvent(e,t)}';
 runInContext(`var n={_onEvent:null,__onAnimationEvent:(${animationEventSource})};var eventDelegate=(${eventDelegateSource});`,context);
 skeleton.setEventListener(context.eventDelegate);
 assert.throws(()=>skeleton.update(.125),/animation event timeline/);
 skeleton.bindLogicalTimelineOwner(context.n,{animationEventSource,eventDelegateSource});skeleton.update(.125);
 context.n._onEvent=()=>{};assert.throws(()=>skeleton.update(.125),/animation event timeline/);
 context.n._onEvent=null;context.n.__onAnimationEvent=()=>{};assert.throws(()=>skeleton.update(.125),/animation event timeline/);
 skeleton.setEventListener(null);assert.throws(()=>skeleton.update(-.1),/logical animation clock domain/);
 skeleton.setTimeScale(NaN);assert.throws(()=>skeleton.update(.1),/logical animation clock domain/);
});
test('pinned original Cocos predicates retain boxed-number and null behavior',async()=>{
 const context=await setup();
 assert.equal(context.cc.isNumber(NaN),true);assert.equal(context.cc.isNumber(new Number(3)),true);assert.equal(context.cc.isNumber('3'),false);
 assert.equal(context.cc.isObject(null),false);assert.equal(context.cc.isObject({}),true);assert.equal(context.cc.isUndefined(undefined),true);
});
