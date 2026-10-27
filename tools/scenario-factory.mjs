import { loadBootstrapTable } from './bootstrap-source.mjs';
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Scenario selection has its own PRNG. It never consumes the battle's ed.rand stream.
function selector(seed) {
  let state=seed>>>0;
  if(state===0)state=0x6d2b79f5;
  return limit=>{
    if(!Number.isSafeInteger(limit)||limit<1)throw new Error('Empty selection pool');
    state^=state<<13;state^=state>>>17;state^=state<<5;
    return(state>>>0)%limit;
  };
}
function shuffled(values,next){
  const out=values.slice();
  for(let i=out.length-1;i>0;i--){const j=next(i+1);[out[i],out[j]]=[out[j],out[i]];}
  return out;
}
let catalogPromise;
export async function scenarioCatalog(){
  if(!catalogPromise)catalogPromise=(async()=>{
    const names=['Unit','UnitQualityLevel','UnitQuality','UnitRankLevel','UnitRank','Equip','EquipQuality','Signature','SignatureLevel','Pet','PetQualityAttr','PetTalentLib','ParamBattleMode'];
    const entries=await Promise.all(names.map(async name=>[name,await loadBootstrapTable(name)]));
    const tables=Object.fromEntries(entries);
    const ascended=Object.values(tables.UnitQualityLevel).find(row=>row.Name==='Ascended'&&row.Star===5);
    if(!ascended||ascended.Quality!==15)throw new Error('Source A5 quality mapping changed');
    const heroes=Object.values(tables.Unit).filter(row=>row.UnitType==='Hero'&&row.Enable&&row.MaxQuality>=ascended.Quality&&tables.UnitQuality[row.ID]?.[ascended.Quality]&&tables.UnitRank[row.ID]?.[20]&&tables.Signature[row.ID]?.MaxLevel>=30&&tables.SignatureLevel[row.ID]?.[30]).sort((a,b)=>a.ID-b.ID);
    const pets=Object.values(tables.Pet).filter(row=>row.Enable&&row.Type==='normal'&&tables.Unit[row.ID]?.UnitType==='Pet'&&tables.PetQualityAttr[row.ID]?.[10]&&row.InitTalentID.length>=8).sort((a,b)=>a.ID-b.ID);
    if(heroes.length<10||pets.length<1)throw new Error('Source lacks required A5/SI30 hero or beast pool');
    const tableDigests=Object.fromEntries(entries.map(([name,table])=>[name,createHash('sha256').update(JSON.stringify(table)).digest('hex')]));
    return {tables,heroes,pets,ascended,tableDigests};
  })();
  return catalogPromise;
}

/** Create a JSON-wire workload, not a running battle or an altered game rule.
 * Defaults are ten distinct randomly selected enabled A5 heroes, source rank20,
 * level360, SI30, all four job-matching T4+5 gear slots, and one mythic beast
 * per side. Beast level360 and eight quality5 legal initial talents are explicit
 * benchmark normalization choices, not claims about a player-account default.
 */
export async function createRealisticScenario(seed=2026,options={}){
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Scenario seed must be uint32');
  const {tables,heroes,pets,ascended,tableDigests}=await scenarioCatalog();
  const settings={mode:'stage',battleId:16001,heroLevel:360,quality:15,signatureLevel:30,gearQuality:13,gearEnhance:5,petQuality:10,petLevel:360,...options};
  if(settings.quality!==ascended.Quality||settings.heroLevel!==360||settings.signatureLevel!==30)throw new Error('This qualification factory requires source A5, level360 and SI30');
  if(!tables.ParamBattleMode[settings.mode]?.Pet)throw new Error('Chosen source battle mode disables beasts');
  if(!tables.EquipQuality[settings.gearQuality]||!Number.isInteger(settings.gearEnhance)||settings.gearEnhance>tables.EquipQuality[settings.gearQuality].MaxEnhanceLevel||settings.gearEnhance<0)throw new Error('Invalid source gear enhancement');
  if(settings.petQuality!==10)throw new Error('This factory currently implements source mythic beasts (quality10)');
  const rank=Object.values(tables.UnitRankLevel).filter(row=>row.TargetLevel<=settings.heroLevel).sort((a,b)=>b.TargetLevel-a.TargetLevel)[0]?.Rank;
  if(rank!==20)throw new Error('Source level360 rank mapping changed');
  const next=selector(seed),chosen=shuffled(heroes,next).slice(0,10);
  function hero(row,index){
    const equips=[];
    for(let position=1;position<=4;position++){
      const candidates=Object.values(tables.Equip).filter(e=>e.Job===row.HeroJob&&e.Position===position&&e.Quality===settings.gearQuality).sort((a,b)=>a.TID-b.TID);
      const gear=candidates[next(candidates.length)];
      equips.push({index:position,equip:{id:(index+1)*10+position,tid:gear.TID,amount:1,attrs:{hero_tag:row.HeroTagID,hero_tid:row.ID},enhance_lv:settings.gearEnhance,enhance_exp:0}});
    }
    return{id:index+1,tid:row.ID,level:settings.heroLevel,pentagram_lv:settings.heroLevel,rank,quality:settings.quality,trans_quality:0,equips,sig:{tid:row.ID,lv:settings.signatureLevel,quality:settings.quality},config:{slotIndex:index%5+1}};
  }
  function beast(id){
    const row=pets[next(pets.length)];
    const talents=shuffled(row.InitTalentID,next).slice(0,8).map(tid=>{
      const qualities=Object.keys(tables.PetTalentLib[tid]??{}).map(Number).filter(Number.isFinite);
      const quality=Math.max(...qualities);
      if(!Number.isFinite(quality))throw new Error(`Missing source pet talent ${tid}`);
      return{tid,quality};
    });
    return{id,tid:row.ID,level:settings.petLevel,pentagram_lv:settings.petLevel,quality:settings.petQuality,talents};
  }
  const players=chosen.slice(0,5).map((row,i)=>hero(row,i));
  const enemies=chosen.slice(5).map((row,i)=>hero(row,i+5));
  const config={mode:settings.mode,battle_id:settings.battleId,localBot:true,pets:{self_pets:[beast(1001)],oppo_pets:[beast(1002)]}};
  const input={version:1,scenarioSeed:seed,battleSeed:1+(seed%2147483646),settings,players,enemies,config,
    qualification:{teamSize:5,heroLevel:360,qualityLabel:'Ascended 5-star',quality:15,rank:20,signatureLevel:30,gearSlots:4,beastsPerTeam:1,timeout:'Original engine rules; no benchmark timeout substitution'},
    source:{heroPoolSize:heroes.length,petPoolSize:pets.length,tableDigests:{...tableDigests}}};
  input.inputSha256=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  return input;
}

/** Materialize fresh source data classes for EACH battle. Immutable wire inputs
 * may be shared; live equip/signature/PetData objects and arrays must not be.
 */
export function instantiateScenario(runtime,input){
  const {ed}=runtime;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const materialize=wire=>{
    const proto=clone(wire);
    proto.equips=proto.equips.map(slot=>({index:slot.index,equip:ed.equipData.create(slot.equip)}));
    proto.sig=ed.signatureData.create(proto.sig);
    return proto;
  };
  const config=clone(input.config);
  config.pets.self_pets=config.pets.self_pets.map(wire=>new ed.PetData(wire));
  config.pets.oppo_pets=config.pets.oppo_pets.map(wire=>new ed.PetData(wire));
  return{players:input.players.map(materialize),enemies:input.enemies.map(materialize),config,battleSeed:input.battleSeed,inputSha256:input.inputSha256};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const seed=Number(process.argv[2]??2026),output=resolve(process.argv[3]??'work/scenario-5v5.json');
  const scenario=await createRealisticScenario(seed);
  await mkdir(resolve(output,'..'),{recursive:true});
  await writeFile(output,JSON.stringify(scenario,null,2)+'\n');
  console.log(JSON.stringify({output,inputSha256:scenario.inputSha256,players:scenario.players.map(x=>x.tid),enemies:scenario.enemies.map(x=>x.tid),beasts:scenario.config.pets,qualification:scenario.qualification}));
}
