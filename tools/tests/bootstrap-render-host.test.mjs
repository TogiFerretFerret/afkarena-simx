import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

async function setup(){
  const context=createContext({cc:{game:{config:null,CONFIG_KEY:{}}},HTMLElement:function HTMLElement(){}});context.window=context;
  for(const file of ['bootstrap-host.js','bootstrap-vendor-CCClass.js','bootstrap-render-host.js'])runInContext(await readFile(new URL(`../${file}`,import.meta.url),'utf8'),context,{filename:file});
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
