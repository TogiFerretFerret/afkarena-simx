import {createBootstrapRuntime} from './bootstrap-runtime.mjs';
import {installBootstrapRenderScene} from './bootstrap-render-scene.mjs';
import {createQualificationScenario,instantiateScenario} from './scenario-factory.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),cases=[];
for(const frameContract of ['callback-phase-only','whole-original-base-scene-onUpdate'])for(const seed of [2026,2027]){
 const runtime=await createBootstrapRuntime({hostRandom:()=>.25});
 const scene=await installBootstrapRenderScene(runtime,{logicalHeroTimeline:true,projectVegelfBodyAttachments:true,recordShaderPrograms:true,initializeLogicalScene:frameContract==='whole-original-base-scene-onUpdate'});
 const wire=await createQualificationScenario(seed),materialized=instantiateScenario(runtime,wire),engine=new runtime.ed.BattleEngine();
 runtime.ed.battleEngine=engine;runtime.ed.srand(materialized.battleSeed);
 let completedFrames=0,completedFrameCallbacks=0,error=null;
 const enteredPhaseCounts={updateActor:0,updateEffect:0,checkDialog:0};
 for(const name of Object.keys(enteredPhaseCounts)){const original=scene.scene[name];scene.scene[name]=function(...args){enteredPhaseCounts[name]++;return original.apply(this,args)}}
 try{
  engine.enterBattle(materialized.players,materialized.enemies,materialized.config);
  while(engine.running&&completedFrames<20000){const phase=(frameContract==='callback-phase-only'?runtime.callbacks.updateFrame(.125):runtime.callbacks.updateSceneFrame(.125));completedFrames++;completedFrameCallbacks+=phase.executed;}
 }catch(failure){error={message:failure.message,stack:failure.stack?.split('\n').slice(0,8)}}
 cases.push({scenarioSeed:seed,frameContract,enteredPhaseCounts,optionalViewUpdatePresent:typeof scene.scene.viewUpdate==='function',inputSha256:wire.inputSha256,scenarioFactoryVersion:wire.factoryVersion,status:error?'unsupported-source-host-dependency':engine.running?'frame-limit':'completed',completedFrames,engineTicks:engine.ticks,completedFrameCallbacks,result:engine.result,error,renderSourceSha256:scene.sha256});
}
const files=['tools/bootstrap-runtime.mjs','tools/bootstrap-render-host.js','tools/bootstrap-render-scene.mjs','tools/bootstrap-body-projection.js','config/stage-body-attachment-projection.json'];
const sourceInputs=Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(resolve(root,f))).digest('hex')])));
const report={version:1,kind:'realistic-independent-team-render-projection-diagnostic',frameInput:.125,sourceInputs,cases,allRequestedCasesCompleted:cases.every(c=>c.status==='completed'),qualifiesForWholeBattleFidelity:false,qualifiesForBattleThroughputTarget:false,scope:'Original engine and queued callbacks, source render methods, opt-in logical hero clock and narrowly proven VegelfMini body projection. Remaining unknown assets/geometry/timelines fail closed. This is not a native/source differential gate or native Spine timing equivalence proof.'};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});await writeFile(resolve(root,'benchmarks/validation/render-projection-realistic.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
