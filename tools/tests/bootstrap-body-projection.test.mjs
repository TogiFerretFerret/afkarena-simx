import test from 'node:test';
import assert from 'node:assert/strict';
import {createBootstrapRuntime} from '../bootstrap-runtime.mjs';
import {installBootstrapRenderScene} from '../bootstrap-render-scene.mjs';
async function setup(project){
 const runtime=await createBootstrapRuntime({hostRandom:()=>.25});
 await installBootstrapRenderScene(runtime,{logicalHeroTimeline:true,projectVegelfBodyAttachments:project,recordShaderPrograms:true});
 runtime.ed.battleEngine.mode='stage';runtime.ed.battleEngine.config=runtime.importValue({mode:'stage'});
 const model=runtime.importValue({camp:1,speeder:1});
 runtime.context.Vegelf.func_upgrade3_babyAction(model,runtime.importValue([100,30]));
 return{runtime,model};
}
test('original Vegelf baby completion retains source model cleanup and constructor instance IDs',async()=>{
 const strict=await setup(false);
 assert.throws(()=>strict.runtime.callbacks.drainCallbacks(),/Missing source render animation duration:.*VegelfMini/);
 const strictNextId=new strict.runtime.context.cc.Node().__instanceId;
 const{runtime,model}=await setup(true);
 assert.equal(runtime.callbacks.drainCallbacks().executed,1);
 assert.equal(model.babyNodeList.length,1);
 const puppet=model.babyNodeList[0].puppet;
 assert.equal(puppet.getCurAction(),'atk');
 assert.equal(puppet._skeletonAnimation._tracks[0].animation.duration,runtime.ed.getDataTable('AnimDuration')['VegelfMini.cha'].atk.Duration);
 const probe=new runtime.context.cc.Node();assert.equal(probe.__instanceId,strictNextId,'original body constructors must preserve later numeric instance IDs');
 assert.equal(runtime.host.events.filter(event=>event.kind==='projected_spine_body_attach').length,2);
 const actor=runtime.importValue({});actor.model=model;
 for(let frame=0;frame<24;frame++)runtime.context.Vegelf.actor_update(()=>{},actor,.125);
 assert.equal(model.babyNodeList.length,1);assert.equal(puppet._actionFinished,false);
 runtime.context.Vegelf.actor_update(()=>{},actor,.125);
 assert.equal(puppet._actionFinished,true);assert.equal(model.babyNodeList.length,0);
 assert.equal(new runtime.context.cc.Node().__instanceId,probe.__instanceId+1,'projected private updates must not allocate additional Cocos instances');
 runtime.ed.setNamedShader(probe,'TimeStopShader');
 assert.equal(probe.getShaderProgram().name,'TimeStopShader');assert.equal(probe._retains,0);
 runtime.ed.setDefaultShader(probe);assert.equal(probe.getShaderProgram().name,'NormalShader');assert.equal(probe._retains,0);
 assert.throws(()=>runtime.context.cc.shaderCache.loadProgram('TimeStopShader',()=>{}),/shader callback\/name proof/);
 const component=puppet._spineEffectComponent;
 assert.throws(()=>component.getFrameEffectData('spine_eff_body_VegelfMini_pet_atk_1','Start'),/single frame-zero creation/);
 component._playEffectList[0].effect._onEvent=()=>{};
 assert.throws(()=>puppet.update(.125),/body effect gained a logical callback/);
});
test('physical body projection rejects changed attachment schemas and excluded modes',async()=>{
 const{runtime,model}=await setup(true);
 const row=runtime.ed.SkillAnimation.VegelfMini.atk[0];row.life_delay=true;
 assert.throws(()=>runtime.callbacks.drainCallbacks(),/frame-zero unique root-only attachment schema/);
 row.life_delay=false;runtime.ed.battleEngine.mode='turnbased';
 runtime.context.Vegelf.func_upgrade3_babyAction(model,runtime.importValue([100,30]));
 assert.throws(()=>runtime.callbacks.drainCallbacks(),/stage\/no-pool contract/);
});
