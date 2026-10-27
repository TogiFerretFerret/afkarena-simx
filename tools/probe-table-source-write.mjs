import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { createBootstrapRuntime } from './bootstrap-runtime.mjs';
import { instantiateScenario } from './scenario-factory.mjs';
const root=resolve(import.meta.dirname,'..');
assert.ok(process.execArgv.includes('--jitless'),'Run with pinned --jitless profile');
assert.equal(process.env.NODE_OPTIONS||'','');
const sha=text=>createHash('sha256').update(text).digest('hex');
const source=await readFile(resolve(root,'src/srcmodule/game_battle.js'),'utf8');
const start=source.indexOf('rebuildPhaseList:function')+'rebuildPhaseList:'.length,end=source.indexOf(',targetSelector:',start);
assert.ok(start>0&&end>start);
const runtime=await createBootstrapRuntime(),wire=JSON.parse(await readFile(resolve(root,'config/scenario-example-2026.json'),'utf8'));
const table=runtime.ed.getDataTable('AnimAtkFrame'),row=table['SPhoenix.cha'].atk['0.5'];
function snapshot(row){return Object.keys(row).map(key=>{const value=row[key];if(typeof value==='number'){const b=Buffer.alloc(8);b.writeDoubleBE(value);return{key,kind:'f64',bits:b.toString('hex')};}return{key,value};});}
const period=runtime.ed.getDataTable('UnitPeriod')[62][2].SlotList;
const periodBefore=Array.from(period,value=>({kind:typeof value,value}));
const before=snapshot(row);assert.equal(Object.hasOwn(row,'Type'),false);
const materialized=instantiateScenario(runtime,wire),engine=new runtime.ed.BattleEngine();runtime.ed.battleEngine=engine;
runtime.ed.srand(materialized.battleSeed);engine.enterBattle(materialized.players,materialized.enemies,materialized.config);
assert.equal(row.Type,'Attack');assert.equal(runtime.ed.getDataTable('AnimAtkFrame'),table);
let aliases=0;for(const unit of engine.unit_list)for(const skill of unit.skill_list)for(const phase of skill.phase_list)for(const event of phase.event_list)if(event===row)aliases++;
assert.ok(aliases>0,'The mutated table row is also the actual skill event object');
while(engine.running)runtime.callbacks.updateFrame(0.125);
assert.equal(runtime.ed.getDataTable('UnitPeriod')[62][2].SlotList,period);
const periodAfter=Array.from(period,value=>({kind:typeof value,value}));
const report={version:1,passed:true,qualifiesForThroughputTarget:false,oracleProfile:JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8')),
 source:{file:'src/srcmodule/game_battle.js',start,end,sha256:sha(source.slice(start,end))},table:'AnimAtkFrame',path:['SPhoenix.cha','atk','0.5'],before,after:snapshot(row),phaseEventAliases:aliases,
 unitPeriod:{table:'UnitPeriod',path:['62','2','SlotList'],before:periodBefore,after:periodAfter,identityStable:true,sourceStatement:'i[t]=parseInt(i[t])',completedBattle:{ticks:engine.ticks,result:engine.result}},
 conclusion:'Original Skill.rebuildPhaseList adds Type=Attack to the shared table row and retains that same object in skill phase event lists. Preserve table mutation and alias identity; neither a read-only table nor a copied event row is faithful.'};
await writeFile(resolve(root,'benchmarks/validation/realistic-table-source-write.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
