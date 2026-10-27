import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {loadTickSource} from '../check-scheduler.mjs';

const {source}=await loadTickSource();
function fixture({mode='stage',maxTicks,limit=90,interval=1/8}={}){
  const results=[];
  const tick=runInNewContext(`(${source})`,{ed:{
    BattleEngine:{modesUsingMaxTicks:maxTicks===undefined?[]:[mode]},
    lookupDataTable:()=>maxTicks,
    halloweenFunBattleMgr:{isHalloweenFunMode:()=>false},
    btLog:{append(){}},
  }});
  const battle={running:true,freeze_level:0,ignore_level:0,time_limit:limit,
    time_skill_add:0,tick_interval:interval,ticks:0,config:{mode},
    enity_list_name:[],alive_enemy_count:5,alive_player_count:5,
    weatherUpdate(){},tickOperation(){},tickRageObjects(){},checkPush(){},
    getTimeRemain(){return this.time_limit+this.time_skill_add},
    toBtLogString(){return ''},
    onBattleEnd(result){results.push(result);this.running=false},
  };
  return {battle,results,tick:()=>tick.call(battle)};
}

test('source stage rules time out at 90 simulated seconds with both teams alive',()=>{
  const f=fixture();
  for(let i=0;i<719;i++)f.tick();
  assert.equal(f.battle.running,true);
  assert.equal(f.battle.time_limit,1/8);
  f.tick();
  assert.deepEqual(f.results,['timeout']);
  assert.equal(f.battle.ticks,720);
  f.tick();
  assert.equal(f.battle.ticks,720,'a stopped battle does not advance');
});

test('source skill extension and freeze delay timeout without shortening the battle',()=>{
  const f=fixture({limit:1/8});
  f.battle.time_skill_add=1/4;
  f.battle.freeze_level=1;
  for(let i=0;i<8;i++)f.tick();
  assert.equal(f.battle.time_limit,1/8);
  assert.equal(f.battle.running,true);
  f.battle.freeze_level=0;
  f.tick();f.tick();
  assert.equal(f.battle.running,true);
  f.tick();
  assert.deepEqual(f.results,['timeout']);
});

test('source terminal precedence preserves victory on the timeout tick',()=>{
  const f=fixture({limit:1/8});
  f.battle.alive_enemy_count=0;
  f.tick();
  assert.deepEqual(f.results,['victory']);
});

test('source configured tick ceiling is defeat and takes precedence over victory',()=>{
  const f=fixture({mode:'bounded-fixture',maxTicks:2});
  f.tick();
  f.battle.alive_enemy_count=0;
  f.tick();
  assert.deepEqual(f.results,['defeat']);
  assert.equal(f.battle.time_limit,89.75);
});
