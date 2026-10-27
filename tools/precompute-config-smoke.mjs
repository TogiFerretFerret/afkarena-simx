import {createBootstrapRuntime} from './bootstrap-runtime.mjs';
import {installBootstrapCallbacks} from './bootstrap-callbacks.mjs';
import {createRealisticScenario,instantiateScenario} from './scenario-factory.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const runtime=await createBootstrapRuntime();const scenario=await createRealisticScenario(Number(process.argv[2]??2026));
const callbacks=await installBootstrapCallbacks(runtime.context);
const materialized=instantiateScenario(runtime,scenario);const {ed,context}=runtime;
const engine=new ed.BattleEngine();ed.battleEngine=engine;ed.srand(materialized.battleSeed);
let status='completed',failure,frames=0,executed=0,phase='enterBattle';
try{
 engine.enterBattle(materialized.players,materialized.enemies,materialized.config);
 phase='update';
 while(engine.running&&frames<20000){const counts=callbacks.updateFrame(engine.tick_interval);executed+=counts.executed;frames++;}
 if(engine.running)status='diagnostic_frame_guard';
}catch(error){status='source_or_host_boundary';failure={phase,message:error.message,stack:error.stack.split('\n').slice(0,10)};}
const report={status,failure,scenarioSeed:scenario.scenarioSeed,inputSha256:scenario.inputSha256,result:engine.result,ticks:engine.ticks,frames,callbacksExecuted:executed,units:engine.unit_list?.map(u=>({tid:u.tid,camp:u.camp,hp:u.hp,mp:u.mp})),pets:engine.pet_list?.map(u=>({tid:u.tid,camp:u.camp})),limitations:runtime.limitations};
await mkdir('work',{recursive:true});await writeFile('work/precompute-5v5-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(status!=='completed')process.exitCode=2;
