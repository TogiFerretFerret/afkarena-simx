import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext} from 'node:vm';
import {installBootstrapCallbacks} from '../bootstrap-callbacks.mjs';
async function setup(){const context=createContext({ed:{clientCall_list:[]}});context.window=context;return{context,callbacks:await installBootstrapCallbacks(context)};}

test('original clientCall enqueues without executing; captured FIFO drains appended callbacks',async()=>{
  const{context,callbacks}=await setup(),events=[];
  context.clientCall(()=>{events.push('a');context.clientCall(()=>events.push('c'))});
  context.clientCall(()=>events.push('b'));
  assert.deepEqual(events,[]);
  assert.deepEqual(callbacks.drainCallbacks(),{queued:2,executed:3,pending:0});
  assert.deepEqual(events,['a','b','c']);
});
test('replacing queue preserves drain reference and appends into replacement queue',async()=>{
  const{context,callbacks}=await setup(),events=[];
  context.clientCall(()=>{events.push('a');context.ed.clientCall_list=[()=>events.push('c')]});
  context.clientCall(()=>{events.push('b');context.clientCall(()=>events.push('d'))});
  assert.deepEqual(callbacks.drainCallbacks(),{queued:2,executed:2,pending:2});
  assert.deepEqual(events,['a','b']);
  callbacks.beginFrame();
  assert.equal(context.ed.clientCall_list.length,0);
});
test('frame reset precedes source engine update; callback exceptions propagate',async()=>{
  const{context,callbacks}=await setup(),events=[];
  context.clientCall(()=>events.push('discarded-before-update'));
  context.ed.battleEngine={update(elapsed){events.push(elapsed);context.clientCall(()=>events.push('callback'))}};
  callbacks.updateFrame(.125);
  assert.deepEqual(events,[.125,'callback']);
  context.clientCall(()=>{throw new Error('original callback failure')});
  context.clientCall(()=>events.push('not-executed'));
  assert.throws(()=>callbacks.drainCallbacks(),/original callback failure/);
  assert.equal(context.ed.clientCall_list.length,1);
});
test('whole source scene update preserves speed, pause and ordered lifecycle phases',async()=>{
  const{context,callbacks}=await setup(),events=[];
  context.ed.bt_speed=3;
  context.ed.fpsTracker={onUpdate(dt){events.push(['fps',dt])}};
  context.ed.battleVFXFilter={onUpdate(dt){events.push(['vfx',dt])}};
  context.ed.battleEngine={update(dt){events.push(['engine',dt]);context.clientCall(()=>events.push(['callback']))}};
  Object.assign(callbacks.sceneHost,{speedRate:2,pauseFlag:false,
    updateActor(dt){events.push(['actors',dt])},updateEffect(dt){events.push(['effects',dt])},
    viewUpdate(dt){events.push(['view',dt])},checkDialog(dt){events.push(['dialog',dt])}});
  callbacks.updateSceneFrame(.125);
  assert.deepEqual(events,[['fps',.125],['vfx',.125],['engine',.75],['callback'],['actors',.75],['effects',.75],['view',.75],['dialog',.75]]);
  events.length=0;callbacks.sceneHost.pauseFlag=true;callbacks.updateSceneFrame(.5);
  assert.deepEqual(events,[['fps',.5],['vfx',.5]]);
});
test('whole scene update rejects incomplete scene initialization and propagates unsupported device phase',async()=>{
  const{context,callbacks}=await setup();
  assert.throws(()=>callbacks.updateSceneFrame(.1),/lifecycle not installed/);
  Object.assign(callbacks.sceneHost,{updateActor(){throw new Error('Missing source render bone geometry')},updateEffect(){},checkDialog(){}});
  assert.throws(()=>callbacks.updateSceneFrame(.1),/constructor state required/);
  Object.assign(callbacks.sceneHost,{speedRate:1,pauseFlag:false});context.ed.bt_speed=1;
  context.ed.fpsTracker={onUpdate(){}};context.ed.battleVFXFilter={onUpdate(){}};
  context.ed.battleEngine={update(){}};
  assert.throws(()=>callbacks.updateSceneFrame(.1),/Missing source render bone geometry/);
});
