import assert from 'node:assert/strict';
import { createRealisticScenario, scenarioCatalog, instantiateScenario } from './scenario-factory.mjs';

const {tables}=await scenarioCatalog();
for(const seed of [0,1,2,2026,0xffffffff]){
  const a=await createRealisticScenario(seed),b=await createRealisticScenario(seed);
  assert.deepEqual(a,b,'scenario selection must be deterministic');
  assert.equal(a.players.length,5);assert.equal(a.enemies.length,5);
  assert.equal(new Set([...a.players,...a.enemies].map(h=>h.tid)).size,10);
  for(const team of [a.players,a.enemies]){
    assert.deepEqual(team.map(h=>h.config.slotIndex),[1,2,3,4,5]);
    for(const hero of team){
      assert.equal(hero.quality,15);assert.equal(hero.level,360);assert.equal(hero.rank,20);
      assert.equal(tables.UnitQualityLevel[hero.quality].Name,'Ascended');assert.equal(tables.UnitQualityLevel[hero.quality].Star,5);
      assert.equal(hero.sig.lv,30);assert.ok(tables.SignatureLevel[hero.tid][30]);
      assert.equal(hero.equips.length,4);
      for(const slot of hero.equips){const row=tables.Equip[slot.equip.tid];assert.equal(row.Job,tables.Unit[hero.tid].HeroJob);assert.equal(row.Position,slot.index);assert.equal(row.Quality,13);assert.equal(slot.equip.enhance_lv,5);}
    }
  }
  for(const pets of [a.config.pets.self_pets,a.config.pets.oppo_pets]){
    assert.equal(pets.length,1);assert.equal(pets[0].talents.length,8);
    for(const talent of pets[0].talents)assert.ok(tables.PetTalentLib[talent.tid][talent.quality]);
  }
}
assert.notDeepEqual((await createRealisticScenario(1)).players,(await createRealisticScenario(2)).players);
let live=false;
if(process.argv.includes('--live')){
  const {createBootstrapRuntime}=await import('./bootstrap-runtime.mjs');
  const runtime=await createBootstrapRuntime();
  const wire=await createRealisticScenario(2026),before=JSON.stringify(wire);
  const a=instantiateScenario(runtime,wire),b=instantiateScenario(runtime,wire);
  for(const hero of [...a.players,...a.enemies]){
    assert.equal(hero.sig.lv,30);assert.equal(hero.sig.isValid,true);
    for(const slot of hero.equips){assert.equal(slot.equip.cfg_id,wire.players.concat(wire.enemies).find(h=>h.id===hero.id).equips.find(s=>s.index===slot.index).equip.tid);assert.equal(slot.equip.enhance_lv,5);assert.equal(slot.equip.quality,13);}
  }
  assert.equal(a.config.pets.self_pets[0].getTalentArr().length,8);
  assert.equal(a.config.pets.oppo_pets[0].getTalentArr().length,8);
  a.players[0].sig.lv=29;a.players[0].equips[0].equip.enhance_lv=4;
  assert.equal(b.players[0].sig.lv,30);assert.equal(b.players[0].equips[0].equip.enhance_lv,5);
  assert.equal(JSON.stringify(wire),before,'materialization must not mutate shared wire input');
  live=true;
}
console.log(JSON.stringify({status:'passed',wireSeeds:5,liveSourceClassIsolationChecked:live,scope:'Realistic input schema and source data-class construction, not a completed battle or fidelity-qualified performance result'}));
