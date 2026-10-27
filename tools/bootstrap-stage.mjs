import { createContext } from 'node:vm';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBootstrapHelpers, loadBootstrapTable } from './bootstrap-source.mjs';
import { installBootstrapDataClasses } from './bootstrap-data.mjs';

/** Minimal battle-wire player proto, using the source Unit table's initial rank/quality.
 * A runtime can pass this through original ed.heroData.create, then retain config.
 * The wire fields match the original getBattleHeroes proto construction schema.
 */
export async function createBootstrapPlayerProto(tid=1,slotIndex=1){
  const units=await loadBootstrapTable('Unit');
  const info=units[tid];
  if(!info||info.UnitType!=='Hero')throw new Error(`Not a source hero Unit: ${tid}`);
  if(!Number.isInteger(slotIndex)||slotIndex<1||slotIndex>5)throw new Error('Player slot must be 1..5');
  return {id:slotIndex,tid,level:1,rank:info.InitialRank,quality:info.InitialQuality,
    equips:[],sig:null,config:{slotIndex}};
}

/** Execute original table-selection and enemy-proto construction functions.
 * This is battle input preparation, not a Cocos runtime or a battle simulation.
 * Data-object methods use the narrow source-derived bootstrap data adapter.
 */
export async function createStageFixture(stageId,{companion=true,contra=false}={}) {
  const tables=new Map();
  for(const name of ['Stage','StageCompanionsTest','StageBattleIdx','StageBattleBoss','StageBattleIndex'])tables.set(name,await loadBootstrapTable(name));
  const boundary=name=>{throw new Error(`Bootstrap requires original runtime adapter: ${name}`);};
  const context=createContext({
    window:{},
    cc:{error:message=>{throw new Error(message);}},
    ed:{
      getDataTable:name=>{if(!tables.has(name))throw new Error(`Bootstrap requires table: ${name}`);return tables.get(name);},
      loginMgr:{isCompanions:()=>companion},
      ContraABTestMgr:{getIsContraPlayer:()=>contra},
      logbugly:message=>{throw new Error(message);},
      equipData:{create:()=>boundary('ed.equipData.create')},
      signatureData:{create:()=>boundary('ed.signatureData.create')},
    },
  });
  await installBootstrapHelpers(context);
  await installBootstrapDataClasses(context);
  const battleIds=context.ed.getBattleIdByStage(stageId,false);
  if(!battleIds)throw new Error(`Unknown stage: ${stageId}`);
  const rounds=[];
  for(let round=0;round<battleIds.length;round++){
    const battleId=battleIds[round];
    const battleInfo=context.ed.getStageBattleInfo(battleId,'stage');
    const enemies=context.ed.getStageHeroes(stageId,round,0,false);
    rounds.push({battleId,battleInfo,enemies});
  }
  return {version:1,stageId,companion,contra,mode:'stage',rounds,
    scope:'Source-executed table selection and enemy-proto construction; source-derived data adapter excludes Cocos metadata; player roster and engine runtime remain caller inputs'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const stageId=Number(process.argv[2]??1);
  if(!Number.isInteger(stageId)||stageId<1)throw new Error('Usage: node tools/bootstrap-stage.mjs STAGE_ID [OUTPUT.json]');
  const fixture=await createStageFixture(stageId);
  const contents=JSON.stringify(fixture,null,2)+'\n';
  if(process.argv[3])await writeFile(resolve(process.argv[3]),contents);
  else process.stdout.write(contents);
}
