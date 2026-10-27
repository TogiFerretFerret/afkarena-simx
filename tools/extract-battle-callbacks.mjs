import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInContext } from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { createStageFixture,createBootstrapPlayerProto } from './bootstrap-stage.mjs';

const root=resolve(import.meta.dirname,'..');
const runtime=await createBootstrapRuntime();
const {ed,context}=runtime;
const evidence=JSON.parse(await readFile(resolve(root,'config/battle-specialization-callbacks.json'),'utf8'));
for(const name of ['clientCall','resetClientCall']){
  const record=evidence.records.find(r=>r.name===name);
  const source=(await readFile(resolve(root,record.file),'utf8')).slice(record.start,record.end);
  assert.equal(createHash('sha256').update(source).digest('hex'),record.sha256);
  context[name]=runInContext(`(${source})`,context);
}
const fixture=await createStageFixture(1),player=await createBootstrapPlayerProto();
const events=[],callbacks=new Map();
const engine=new ed.BattleEngine();ed.battleEngine=engine;
ed.srand(1);ed.clientCall_list=[];
function state(){return {ticks:engine.ticks,rng:context.random_seed,serialized:engine.toString()};}
function drain(){
  ed.clientCallCount=ed.clientCall_list.length;
  const captured=ed.clientCall_list;
  while(captured.length){
    const callback=captured.shift(),source=Function.prototype.toString.call(callback);
    const hash=createHash('sha256').update(source).digest('hex');
    callbacks.set(hash,{source,count:(callbacks.get(hash)?.count??0)+1});
    const before=state();
    try{callback();}
    catch(error){events.push({kind:'callback_error',hash,before,message:error.message,stack:error.stack.split('\n').slice(0,6)});throw error;}
    const after=state();
    events.push({kind:'callback',hash,before,after,battleStateChanged:before.serialized!==after.serialized||!Object.is(before.rng,after.rng)});
  }
}
let status='completed',failure;
try{
  engine.enterBattle([player],fixture.rounds[0].enemies,{mode:'stage',battle_id:fixture.rounds[0].battleId,localBot:true});
  events.push({kind:'setup_queue',count:ed.clientCall_list.length});
  while(engine.running&&engine.ticks<6000){
    // Match base-scene queue clear -> source engine.update -> captured queue drain.
    ed.clientCall_list=[];
    engine.update(engine.tick_interval);
    drain();
  }
  if(engine.running)status='tick_limit';
}catch(error){status='host_dependency';failure={message:error.message,stack:error.stack.split('\n').slice(0,8)};}
const report={version:1,status,failure,result:engine.result,ticks:engine.ticks,events,callbacks:[...callbacks].map(([hash,value])=>({hash,...value})),
  contract:'Original base-scene producer/reset/frame drain order; original callbacks executed with actor-null headless units; source GUI actor/effect/checkDialog update and full scene state are not provided',
  limitations:runtime.limitations};
await mkdir(resolve(root,'work'),{recursive:true});
await writeFile(resolve(root,'work/battle-callbacks.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status,failure,result:engine.result,ticks:engine.ticks,eventCount:events.length,uniqueCallbackBodies:callbacks.size,report:'work/battle-callbacks.json'}));
if(status!=='completed')process.exitCode=2;
