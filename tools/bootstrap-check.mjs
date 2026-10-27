import assert from 'node:assert/strict';
import { createContext } from 'node:vm';
import { loadBootstrapFunctions, loadBootstrapTable, loadBootstrapTableSync } from './bootstrap-source.mjs';
import { createStageFixture } from './bootstrap-stage.mjs';
import { installBootstrapDataClasses } from './bootstrap-data.mjs';

// Real data + real source helpers: no copied team-selection implementation.
let preparedStages=0;
for(let stage=1;stage<=12;stage++){
  const fixture=await createStageFixture(stage);
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
const packed=await loadBootstrapTable('GuildIceBreakAllocateByContribute');
assert.deepEqual(packed,loadBootstrapTableSync('GuildIceBreakAllocateByContribute'));
assert.equal(packed[1].Percent,20);
assert.equal(packed[2].RewardPercent,60);
const equipped=await createStageFixture(7);
const equip=equipped.rounds.flatMap(r=>r.enemies).flatMap(h=>h.equips).map(e=>e.equip)[0];
assert.ok(equip);
assert.equal(equip.tid,equip._data.tid);
const originalEnhancement=equip.enhance_lv;
equip.enhance_lv=originalEnhancement+1;
assert.equal(equip._data.enhance_lv,originalEnhancement+1);
assert.equal(equip._originalData.enhance_lv,originalEnhancement);
const dataContext=createContext({ed:{}});
await installBootstrapDataClasses(dataContext);
const signatureInput={lv:12,isNpc:true};
const signature=dataContext.ed.signatureData.create(signatureInput);
assert.equal(signature.lv,12);
assert.equal(signature.isValid,true);
signature.lv=13;
assert.equal(signatureInput.lv,13,'Source signature constructor retains input alias');

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
assert.equal(preparedStages,12);
console.log('Bootstrap checks passed: 12 real stage fixtures, original equip/signature getters and mutation semantics, setup RNG consumption and shuffle-dependent unit order. This is not a full battle test; data adapter excludes Cocos metadata.');
