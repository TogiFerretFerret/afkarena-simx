import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root=resolve(import.meta.dirname,'..');
export function classifyPreflightFailure(message){
 if(/Missing source render animation duration/.test(message))return 'missing-animation-duration';
 if(/Missing source render sprite atlas frame geometry/.test(message))return 'missing-atlas-frame-geometry';
 if(/Missing source render/.test(message))return 'missing-render-asset-or-metadata';
 if(/not a constructor|is not a function|is not defined/.test(message))return 'unsupported-source-host-api';
 if(/ClassManager observer violation/.test(message))return 'allocator-observer-invariant';
 return 'source-or-host-exception';
}
const bits=value=>{if(typeof value!=='number')return null;const b=Buffer.allocUnsafe(8);b.writeDoubleBE(value);return b.toString('hex');};
async function runCase(seed,heroSelection,maxFrames){
 const {createBootstrapRuntime}=await import('./bootstrap-runtime.mjs');
 const {installBootstrapRenderScene}=await import('./bootstrap-render-scene.mjs');
 const {createQualificationScenario,instantiateScenario}=await import('./scenario-factory.mjs');
 const wire=await createQualificationScenario(seed,{heroSelection});
 const random=[];
 const runtime=await createBootstrapRuntime({eagerBattle:true,observeClassManager:true,hostRandom(){random.push(.25);return .25;},hostClock:{mode:'record',tape:[]}});
 let engine,render,stage='render-initialization',activePhase=null,failedPhase=null,error=null,completedFrames=0,attemptedFrames=0,completedFrameCallbacks=0;
 const enteredPhaseCounts={updateActor:0,updateEffect:0,checkDialog:0};
 try{
  render=await installBootstrapRenderScene(runtime,{logicalHeroTimeline:true,projectVegelfBodyAttachments:true,recordShaderPrograms:true,initializeLogicalScene:true});
  for(const name of Object.keys(enteredPhaseCounts)){
   const original=render.scene[name];
   render.scene[name]=function(...args){activePhase=name;enteredPhaseCounts[name]++;try{return original.apply(this,args);}catch(failure){failedPhase=activePhase;throw failure;}finally{activePhase=null;}};
  }
  stage='battle-materialization';
  const input=instantiateScenario(runtime,wire);
  engine=new runtime.ed.BattleEngine();runtime.ed.battleEngine=engine;runtime.ed.srand(input.battleSeed);
  stage='enterBattle';engine.enterBattle(input.players,input.enemies,input.config);
  stage='whole-original-scene-frame';
  while(engine.running&&completedFrames<maxFrames){
   attemptedFrames++;
   const phase=runtime.callbacks.updateSceneFrame(.125);
   completedFrames++;completedFrameCallbacks+=phase.executed;
  }
 }catch(failure){error={classification:classifyPreflightFailure(failure.message),message:failure.message,stage,phase:failedPhase??activePhase,stack:failure.stack?.split('\n').slice(0,8)};}
 const clock=runtime.clock.finish(),allocator=runtime.classManagerObserver.finish();
 return {scenarioSeed:seed,heroSelection,inputSha256:wire.inputSha256,battleSeed:wire.battleSeed,scenarioFactoryVersion:wire.source.factoryVersion,
  input:wire,hostInputs:{random,clock:runtime.clock.tape,clockStats:clock},
  status:error?'unsupported-source-host-dependency':engine?.running?'frame-limit':'completed',
  attemptedFrames,completedFrames,completedFrameCallbacks,enteredPhaseCounts,
  engine:{ticks:engine?.ticks??null,running:engine?.running??null,result:engine?.result??null,timeLimitBits:bits(engine?.time_limit),timeSkillAddBits:bits(engine?.time_skill_add),tickIntervalBits:bits(engine?.tick_interval)},
  allocator,error,renderSourceSha256:render?.sha256??null,callbackProvenance:runtime.callbacks.provenance,sourceRecordsCacheKey:runtime.sourceRecordsCache.key,hostSources:runtime.sourceRecords.hostSources.map(({file,source,phase})=>({file,phase,sha256:createHash('sha256').update(source).digest('hex')})),classManagerProofSha256:runtime.classManagerObserverProvenance.proofSha256,eagerModules:runtime.sourceRecords.eagerModules.map(({file,sha256})=>({file,sha256})),
  qualifiesForWholeBattleFidelity:false,qualifiesForBattleThroughputTarget:false};
}
async function main(){
 const args=process.argv.slice(2);
 if(args[0]==='--worker'){
  const [seed,selection,maxFrames]=args.slice(1);
  const result=await runCase(Number(seed),selection,Number(maxFrames));
  console.log('PREFLIGHT_RESULT '+JSON.stringify(result));return;
 }
 let seeds=Array.from({length:8},(_,i)=>2026+i),output='benchmarks/validation/random-5v5-preflight.json',maxFrames=20000;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--seeds')seeds=args[++i].split(',').map(Number);
  else if(args[i]==='--output')output=args[++i];
  else if(args[i]==='--max-frames')maxFrames=Number(args[++i]);
  else throw new Error(`Unknown argument: ${args[i]}`);
 }
 assert.ok(seeds.length>0&&seeds.every(n=>Number.isInteger(n)&&n>=0&&n<=0xffffffff),'seeds must be uint32');
 assert.ok(Number.isSafeInteger(maxFrames)&&maxFrames>0,'max frames must be a positive safety bound, not an altered battle timeout');
 const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
 assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.equal(process.platform,profile.platform);assert.equal(process.arch,profile.architecture);
 const files=['tools/preflight-random-battles.mjs','tools/scenario-factory.mjs','tools/bootstrap-runtime.mjs','tools/bootstrap-render-host.js','tools/bootstrap-render-scene.mjs','tools/bootstrap-body-projection.js','tools/bootstrap-callbacks.mjs','tools/oracle-class-manager.js','tools/oracle-clock.js','config/stage-body-attachment-projection.json','config/scenario-contract.json','config/oracle-class-manager.json','config/source-oracle-runtime.json','src/srcmodule/game_battle.js','src/srcmodule/game_ui_1.js','src/res/spine.json','src/res/hero.json','src/res/effect.json'];
 const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')])));
 const sourceInputs=await hashes();
 const requests=[...seeds.map(seed=>({seed,selection:'independent-teams'})),{seed:seeds[0],selection:'mirrored'},{seed:seeds[0],selection:'reversed-mirror'}];
 const cases=[];
 for(const request of requests){
  const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,resolve(root,'tools/preflight-random-battles.mjs'),'--worker',String(request.seed),request.selection,String(maxFrames)],{cwd:root,env:{...process.env,NODE_OPTIONS:''},encoding:'utf8',maxBuffer:8*1024*1024});
  if(child.error)throw child.error;
  const line=child.stdout?.split('\n').find(line=>line.startsWith('PREFLIGHT_RESULT '));
  if(child.status!==0||!line)throw new Error(`Worker failed for ${JSON.stringify(request)}: ${child.stderr}\n${child.stdout}`);
  const result=JSON.parse(line.slice('PREFLIGHT_RESULT '.length));cases.push(result);
  console.log(JSON.stringify({seed:request.seed,selection:request.selection,status:result.status,ticks:result.engine.ticks,error:result.error?.message}));
 }
 const after=await hashes(),sourceInputsUnchanged=JSON.stringify(sourceInputs)===JSON.stringify(after);
 const classifications={};for(const c of cases){const key=c.error?.classification??c.status;classifications[key]=(classifications[key]??0)+1;}
 const report={version:1,kind:'random-5v5-full-original-scene-preflight',referenceProfile:profile,sourceInputs,sourceInputsUnchanged,frameInput:.125,maxFramesSafetyBound:maxFrames,
  timeoutPolicy:'Original BattleEngine mode and timeout rules. The frame safety bound yields frame-limit, never a fabricated terminal result.',
  renderContract:'Whole original base scene onUpdate; original callbacks, actor/effect/dialog phases. Opt-in source AnimDuration f64 clock, narrow proven Vegelf body projection and recorded GPU programs; native Spine float/event equivalence remains unproven. Unknown clips/assets/geometry/APIs fail closed.',
  cases,summary:{requested:cases.length,completed:cases.filter(c=>c.status==='completed').length,classifications,allRequestedCasesCompleted:cases.every(c=>c.status==='completed')},
  qualifiesForWholeBattleFidelity:false,qualifiesForBattleThroughputTarget:false,scope:'Source dependency coverage preflight only. No omitted phase counts as completion and no throughput is claimed.'};
 await mkdir(resolve(root,output,'..'),{recursive:true});await writeFile(resolve(root,output),JSON.stringify(report,null,2)+'\n');
 assert.ok(sourceInputsUnchanged,'Source inputs changed during corpus run; rerun against a stable contract');
 console.log(JSON.stringify({output,summary:report.summary}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
