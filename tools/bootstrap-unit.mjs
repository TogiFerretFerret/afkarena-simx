import { createStageFixture } from './bootstrap-stage.mjs';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';

const stageId=Number(process.argv[2]??1);
const fixture=await createStageFixture(stageId);
const runtime=await createBootstrapRuntime();
const {ed}=runtime;
let phase='construct_engine';
try{
  const engine=new ed.BattleEngine();
  ed.battleEngine=engine;
  ed.srand(1);
  phase='enter_battle';
  const enemies=fixture.rounds[0].enemies;
  engine.enterBattle(structuredClone(enemies),structuredClone(enemies),{mode:'stage',battle_id:fixture.rounds[0].battleId,localBot:true});
  phase='tick_battle';
  while(engine.running&&engine.ticks<6000)engine.tick();
  console.log(JSON.stringify({status:engine.running?'tick_limit':'completed',phase,fixture:'mirror_stage1',result:engine.result,ticks:engine.ticks,units:engine.unit_list?.map(unit=>({tid:unit.tid,camp:unit.camp,hp:unit.hp,position:unit.position})),loadedSymbols:runtime.loaded,limitations:runtime.limitations}));
}catch(error){
  console.log(JSON.stringify({status:'dependency_boundary',phase,message:error.message,stack:error.stack.split('\n').slice(0,7),loadedSymbols:runtime.loaded,limitations:runtime.limitations},null,2));
  process.exitCode=2;
}
