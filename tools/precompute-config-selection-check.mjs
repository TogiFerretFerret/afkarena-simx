import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRealisticScenario,createQualificationScenario} from './scenario-factory.mjs';

const frozen=JSON.parse(await readFile(new URL('../config/scenario-example-2026.json',import.meta.url),'utf8'));
const legacy=await createRealisticScenario(2026);
assert.deepEqual(legacy,frozen,'legacy v1 source fixture must remain byte-equivalent');
let overlapCases=0,firstOverlap;
for(let seed=0;seed<128;seed++){
 const scenario=await createQualificationScenario(seed);
 const a=scenario.players.map(x=>x.tid),b=scenario.enemies.map(x=>x.tid);
 assert.equal(new Set(a).size,5);assert.equal(new Set(b).size,5);
 assert.equal(scenario.source.factoryVersion,2);assert.equal(scenario.settings.heroSelection,'independent-teams');
 const overlap=a.filter(id=>b.includes(id));
 if(overlap.length){overlapCases++;firstOverlap??={seed,heroes:overlap};}
 assert.equal(scenario.config.pets.self_pets.length,1);assert.equal(scenario.config.pets.oppo_pets.length,1);
}
assert.ok(overlapCases>0,'random qualification corpus must exercise cross-camp same-hero cases');
for(const heroSelection of ['mirrored','reversed-mirror']){
 const scenario=await createQualificationScenario(2026,{heroSelection});
 const a=scenario.players.map(x=>x.tid),b=scenario.enemies.map(x=>x.tid);
 assert.deepEqual(b,heroSelection==='mirrored'?a:a.slice().reverse());
 for(let i=0;i<5;i++){const enemy=scenario.enemies[heroSelection==='mirrored'?i:4-i];assert.notEqual(scenario.players[i],enemy);assert.notEqual(scenario.players[i].equips,enemy.equips);assert.notEqual(scenario.players[i].sig,enemy.sig);}
}
console.log(JSON.stringify({status:'passed',legacyV1Preserved:true,qualificationVersion:2,seeds:128,overlapCases,firstOverlap,targetedSelections:['mirrored','reversed-mirror'],scope:'Scenario selection and source input identity; not a battle fidelity or performance claim'}));
