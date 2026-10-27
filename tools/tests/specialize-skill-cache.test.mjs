import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext,runInContext } from 'node:vm';
import { loadBootstrapTableSync } from '../bootstrap-source.mjs';
import { installSkillCacheSpecialization } from '../specialize-skill-cache.mjs';

async function fixture(){
  const source=await readFile(new URL('../../src/srcmodule/game_ui_1.js',import.meta.url),'utf8');
  const from=source.indexOf('ed.getNeedReadSkillCacheTb=function('),to=source.indexOf(',ed.swapBattleRecord=',from);
  const events=[],param=loadBootstrapTableSync('Param');
  const context=createContext({events,param});
  runInContext(`var cc={warn:function(){events.push(['warn'].concat(Array.prototype.slice.call(arguments)))}};
    var battleId=1;var ed={battle_camp:{enemy:2},battleEngine:{config:{mode:'stage'},getBattleId:function(){events.push(['battleId']);return battleId;}},getDataTable:function(name){events.push(['table',name]);return param;}};
    ${source.slice(from,to)};`,context);
  return{context,ed:context.ed,events,param};
}
test('cached nonescaping parsed table matches 20k source queries and external call order',async()=>{
  const a=await fixture(),b=await fixture(),cache=await installSkillCacheSpecialization(b);
  a.events.length=b.events.length=0;
  const modes=['stage','tower','deep_stage','raid','tower_orc','heroes_lore','unknown',null];
  const ids=[0,1,9000,9001,20001,29000,29001,100001,109000,1000001,1009000,9999999,7000100,7040030,NaN,Infinity,-0];
  for(let i=0;i<20000;i++){
    for(const f of [a,b]){f.ed.battleEngine.config.mode=modes[i%modes.length];f.context.battleId=ids[(i*7)%ids.length];}
    const e=i%17===0?null:{info:{ID:i%3===0?'55':i%3===1?62:999},camp:i%2===0?2:1};
    assert.equal(b.ed.getNeedReadSkillCacheTb(e),a.ed.getNeedReadSkillCacheTb(e),`query ${i}`);
    assert.equal(JSON.stringify(b.events),JSON.stringify(a.events),`external calls ${i}`);a.events.length=b.events.length=0;
  }
  assert.ok(cache.stats().hits>10000);assert.equal(cache.stats().misses,0);
});
test('changed parameter and parser use the original path, retaining warnings',async()=>{
  const a=await fixture(),b=await fixture(),cache=await installSkillCacheSpecialization(b);
  for(const f of [a,b])f.param.Stage.UseSkillCacheStageBattle.StrValue='1;stage;1';
  a.events.length=b.events.length=0;
  const e={info:{ID:55},camp:2};
  assert.equal(b.ed.getNeedReadSkillCacheTb(e),a.ed.getNeedReadSkillCacheTb(e));assert.equal(JSON.stringify(b.events),JSON.stringify(a.events));
  runInContext('ed.parseUseSkillCacheStageBattle=function(){events.push(["replacement"]);return {stage:[[0,10]]}}',b.context);
  b.events.length=0;assert.equal(b.ed.getNeedReadSkillCacheTb(e),true);assert.ok(b.events.some(e=>e[0]==='replacement'));assert.equal(cache.stats().misses,2);
});
test('inherited mode mutation disables cached map',async()=>{
  const f=await fixture(),cache=await installSkillCacheSpecialization(f);
  runInContext('Object.prototype.stage=[]',f.context);
  const e={info:{ID:55},camp:2};assert.equal(f.ed.getNeedReadSkillCacheTb(e),true);assert.equal(cache.stats().misses,1);
  assert.equal(runInContext('Object.prototype.stage.length',f.context),1);
});
