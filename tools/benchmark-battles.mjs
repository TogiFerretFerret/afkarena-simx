import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { createStageFixture } from './bootstrap-stage.mjs';
import { bits } from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..');
const options={stage:1,battles:100,warmup:3,seed:2026,maxTicks:20000};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i].replace(/^--/,'');
  if(!(key in options)||!Number.isSafeInteger(Number(process.argv[i+1])))throw new Error('Usage: node tools/benchmark-battles.mjs [--stage N] [--battles N] [--warmup N] [--seed N] [--maxTicks N]');
  options[key]=Number(process.argv[i+1]);
}
if(options.battles<1||options.warmup<0||options.maxTicks<1)throw new Error('Positive battle/tick counts required');
const start=performance.now();
const fixture=await createStageFixture(options.stage);
if(fixture.rounds.length!==1)throw new Error('Benchmark currently requires a single-round stage');
const runtime=await createBootstrapRuntime();
const {ed,context}=runtime;
const round=fixture.rounds[0];
if(!round.enemies.length)throw new Error('An empty team is not a battle benchmark');
// Same source-defined unit types on both sides: a deterministic contested workload,
// not an assertion that monsters are a legal player roster for team optimization.
function runBattle(){
  const setupStart=performance.now();
  const engine=new ed.BattleEngine();
  ed.battleEngine=engine;
  ed.srand(options.seed);
  const player=context.cc.clone(round.enemies);
  const enemy=context.cc.clone(round.enemies);
  engine.enterBattle(player,enemy,{mode:'stage',battle_id:round.battleId,localBot:true});
  if(!engine.unit_list.some(u=>u.camp===ed.battle_camp.player)||!engine.unit_list.some(u=>u.camp===ed.battle_camp.enemy))throw new Error('Both camps must contain units');
  const simulationStart=performance.now();
  let ticks=0;
  while(engine.running&&ticks<options.maxTicks){engine.tick();ticks++;}
  const end=performance.now();
  if(engine.running)throw new Error(`Battle failed to terminate in ${options.maxTicks} ticks`);
  if(!['victory','defeat','timeout'].includes(engine.result))throw new Error(`Unexpected battle result: ${engine.result}`);
  const encode=value=>typeof value==='number'?bits(value):String(value);
  const final={result:engine.result,ticks,engineTicks:encode(engine.ticks),rng:encode(context.random_seed),units:engine.unit_list.map(u=>({tid:u.tid,camp:u.camp,hp:encode(u.hp),mp:encode(u.mp),position:u.position.map(encode)}))};
  return {setupMs:simulationStart-setupStart,simulationMs:end-simulationStart,signature:createHash('sha256').update(JSON.stringify(final)).digest('hex'),final};
}
const coldSetupMs=performance.now()-start;
let reference;
for(let i=0;i<Math.max(1,options.warmup);i++){
  const result=runBattle();
  if(reference&&result.signature!==reference.signature)throw new Error('Warmup battles are not deterministic');
  reference=result;
}
let setupMs=0,simulationMs=0,totalTicks=0;
const timedStart=performance.now();
for(let i=0;i<options.battles;i++){
  const result=runBattle();
  if(result.signature!==reference.signature)throw new Error(`Battle ${i} differs from the fixed-seed reference`);
  setupMs+=result.setupMs;simulationMs+=result.simulationMs;totalTicks+=result.final.ticks;
}
const wallMs=performance.now()-timedStart;
const report={version:1,engine:'js-source-provisional-headless',validatedAgainstOriginalRuntime:false,
  fixture:'mirrored stage enemy prototypes; nonempty teams',options,coldSetupMs,
  completedBattles:options.battles,totalTicks,wallMs,setupMs,simulationMs,
  battlesPerSecond:options.battles*1000/wallMs,simulationOnlyBattlesPerSecond:options.battles*1000/simulationMs,
  ticksPerSecond:totalTicks*1000/simulationMs,reference:reference.final,signature:reference.signature,
  limitations:runtime.limitations};
await mkdir(resolve(root,'work'),{recursive:true});
await writeFile(resolve(root,'work/battle-benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
