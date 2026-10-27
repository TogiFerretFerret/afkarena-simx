import assert from 'node:assert/strict';
import { createContext } from 'node:vm';
import { loadBootstrapFunctions } from './bootstrap-source.mjs';
import { createStageFixture } from './bootstrap-stage.mjs';

// Real data + real source helpers: no copied team-selection implementation.
let preparedStages=0;
for(let stage=1;stage<=12;stage++){
  let fixture;
  try{fixture=await createStageFixture(stage);}
  catch(error){
    assert.equal(stage,7,'Unexpected unsupported stage');
    assert.match(error.message,/original runtime adapter: ed\.equipData\.create/);
    continue;
  }
  preparedStages++;
  assert.equal(fixture.mode,'stage');
  assert.ok(fixture.rounds.length>0);
  for(const round of fixture.rounds){
    assert.equal(round.battleInfo.BattleID,round.battleId);
    assert.ok(round.enemies.length>0);
    for(const enemy of round.enemies){assert.ok(enemy.tid>0);assert.ok(enemy.config.slotIndex>=1&&enemy.config.slotIndex<=5);}
  }
}
const fixture=await createStageFixture(1);
assert.equal(fixture.rounds[0].battleId,16001);
assert.equal(fixture.rounds[0].enemies[0].tid,1008);
assert.equal(fixture.rounds[0].enemies[0].config.hp_mod,.55);

// Exercise original initHeroInfo orchestration at explicit UnitCreate boundary.
for(const [shuffle,roll,expectedOrder,expectedDraws] of [
  [false,.1,['p1','p2','e1'],20],
  [true,.1,['e1','p1','p2'],21],
  [true,.9,['p1','p2','e1'],21],
]){
  let draws=0;
  const created=[];
  const context=createContext({ed:{rand:()=>{draws++;return roll;},battle_camp:{player:1,enemy:-1},UnitCreate:(hero,config)=>{created.push({id:hero.id,config});return hero;}}});
  const functions=await loadBootstrapFunctions(context);
  const engine={config:{},shuffleUnitList:shuffle,getTeamTexas:()=>[],createConfig:(hero,camp)=>({id:hero.id,camp}),addUnit:()=>{}};
  functions.get('ed.BattleEngine.initHeroInfo').call(engine,[{id:'p1'},{id:'p2'}],[{id:'e1'}],{});
  assert.equal(draws,expectedDraws);
  assert.deepEqual(created.map(x=>x.id),expectedOrder);
}
assert.equal(preparedStages,11);
console.log('Bootstrap checks passed: 11 real stage fixtures; stage 7 explicitly requires original equipData adapter; stage 1 -> battle 16001 -> enemy 1008; setup RNG consumption and shuffle-dependent unit order. This is not a full battle test.');
