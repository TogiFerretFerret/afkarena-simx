import { createContext } from 'node:vm';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installBootstrapHelpers, loadBootstrapTable } from './bootstrap-source.mjs';

/** Execute original table-selection and enemy-proto construction functions.
 * This is battle input preparation, not a Cocos runtime or a battle simulation.
 * Equipped/signature-bearing enemies fail explicitly until their real adapters load.
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
  const battleIds=context.ed.getBattleIdByStage(stageId,false);
  if(!battleIds)throw new Error(`Unknown stage: ${stageId}`);
  const rounds=[];
  for(let round=0;round<battleIds.length;round++){
    const battleId=battleIds[round];
    const battleInfo=context.ed.getStageBattleInfo(battleId,'stage');
    const enemies=context.ed.getStageHeroes(stageId,round,0,false);
    rounds.push({battleId,battleInfo,enemies});
  }
  return JSON.parse(JSON.stringify({version:1,stageId,companion,contra,mode:'stage',rounds,
    scope:'Source-executed table selection and enemy-proto construction only; player roster and engine runtime remain caller inputs'}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const stageId=Number(process.argv[2]??1);
  if(!Number.isInteger(stageId)||stageId<1)throw new Error('Usage: node tools/bootstrap-stage.mjs STAGE_ID [OUTPUT.json]');
  const fixture=await createStageFixture(stageId);
  const contents=JSON.stringify(fixture,null,2)+'\n';
  if(process.argv[3])await writeFile(resolve(process.argv[3]),contents);
  else process.stdout.write(contents);
}
