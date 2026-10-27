import { createContext,runInContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { loadTickSource } from './check-scheduler.mjs';
import { bits } from './rng-trace.mjs';
const root=resolve(import.meta.dirname,'..');
if(!process.argv[2])throw new Error('Usage: node tools/check-engine.mjs BINARY');
const {source,metadata}=await loadTickSource();
const modes=['stage','rt_pvp','deep_stage','halloween','race_dream','none'];
let b,c,events,lists,group;
function snapshot(){
 const s={running:b.running,will_restart_game:b.willRestartGame,mode:b.mode,config_mode:b.config.mode??null,
  special_time_limit:b.special_time_limit===undefined?null:bits(b.special_time_limit),limit_dead_count:b.limitDeadCount===undefined?null:bits(b.limitDeadCount)};
 for(const [key,name] of [['freeze_level','freeze_level'],['ignore_level','ignore_level'],['time_limit','time_limit'],['time_skill_add','time_skill_add'],['tick_interval','tick_interval'],['ticks','ticks'],['enemy_hero_dead_count','enemy_hero_dead_count'],['player_hero_dead_count','player_hero_dead_count'],['alive_enemy_count','alive_enemy_count'],['alive_player_count','alive_player_count']])s[key]=bits(b[name]);
 s.groups=[lists.indexOf(group)];s.lists=lists.map(l=>Array.from(l,e=>e.id));s.entities=b.all.map(e=>({frozen:e.frozen_model,terminated:e.terminated}));return s;
}
function event(kind){events.push({kind,state:snapshot()});}
const context=createContext({ed:{
 halloweenFunBattleMgr:{isHalloweenFunMode:mode=>{event('is_halloween');return mode==='halloween'}},
 BattleEngine:{modesUsingMaxTicks:{indexOf:()=>{event('uses_max_ticks');return c.max?0:-1}}},
 getDataTable:()=>{event('rt_limit');return{PlayerHP:{Value:c.rt}}},
 lookupDataTable:table=>{event(table==='DeepStage'?'deep_limit':'max_ticks');return table==='DeepStage'?c.deep:c.maxValue},
 btLog:{append:text=>{assert.equal(text,'tick');event('append_log')}},
}});
const tick=runInContext(`(${source})`,context);
function oracle(s){c=s;events=[];
 b={running:s.running,mode:modes[s.mode],config:{mode:s.configMode===5?undefined:modes[s.configMode]},freeze_level:s.freeze,ignore_level:s.ignore,time_limit:s.time,time_skill_add:s.skill,special_time_limit:s.specialPresent?s.special:undefined,tick_interval:s.interval,ticks:s.ticks,willRestartGame:s.restart,limitDeadCount:s.limitPresent?s.limit:undefined,enemy_hero_dead_count:s.enemyDead,player_hero_dead_count:s.playerDead,alive_enemy_count:s.aliveEnemy,alive_player_count:s.alivePlayer,
 enity_list_name:['unit_list'],getMode(){return this.mode},getTimeRemain(){return this.time_limit+this.time_skill_add},
 weatherUpdate(){event('weather_update');if(s.weatherPresent)this.tick_interval=s.weatherInterval},tickOperation(){event('tick_operation');if(s.stop)this.running=false},tickRageObjects(){event('tick_rage_objects')},checkVictoryTimeFixInRaceDream(e){event(`race_fix:${e.id}`)},checkPush(){event('check_push')},skillBattleRestart(){event('restart');if(s.restartMode<6)this.config.mode=s.restartMode===5?undefined:modes[s.restartMode]},checkHalloweenFunBattleEnd(){event('halloween_end')},onBattleEnd(result){event(`end:${result}`);this.running=false},toBtLogString(){event('format_log');return'tick'},
 };
 b.all=s.entities.map((e,id)=>({id,frozen_model:e.frozen,terminated:e.terminated,update(){event(`update_entity:${id}`);switch(e.action){case 1:b.alive_enemy_count-=1;break;case 2:b.alive_player_count-=1;break;case 3:b.willRestartGame=true;break;case 4:this.terminated=true;break;case 5:b.mode='race_dream';break;case 6:b.tick_interval*=2;break;case 7:b.all[(id+1)%b.all.length].frozen_model=true;break;}}}));
 lists=[b.all.slice()];group=lists[0];Object.defineProperty(b,'unit_list',{get:()=>group,set:value=>{if(!lists.includes(value))lists.push(value);group=value}});
 tick.call(b);return{events,final:snapshot()};
}
function serialize(s){return[+s.running,s.mode,s.configMode,...[s.freeze,s.ignore,s.time,s.skill].map(bits),+s.specialPresent,bits(s.special),bits(s.interval),bits(s.ticks),+s.restart,+s.limitPresent,bits(s.limit),...[s.enemyDead,s.playerDead,s.aliveEnemy,s.alivePlayer,s.rt,s.deep].map(bits),+s.max,bits(s.maxValue),+s.weatherPresent,bits(s.weatherInterval),s.restartMode,+s.stop,s.entities.length,...s.entities.flatMap(e=>[+e.frozen,+e.terminated,e.action])].join(' ')}
let state=0x5783421;function next(n){state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%n}
const numbers=[0,-0,1,-1,.125,.1,90,4800,NaN,Infinity,-Infinity,Number.MIN_VALUE,Number.MAX_VALUE];
const pick=()=>numbers[next(numbers.length)];
const cases=Array.from({length:20000},()=>({running:next(10)!==0,mode:next(6),configMode:next(6),freeze:pick(),ignore:pick(),time:pick(),skill:pick(),specialPresent:next(2)===1,special:pick(),interval:pick(),ticks:pick(),restart:next(2)===1,limitPresent:next(2)===1,limit:pick(),enemyDead:pick(),playerDead:pick(),aliveEnemy:pick(),alivePlayer:pick(),rt:pick(),deep:pick(),max:next(2)===1,maxValue:pick(),weatherPresent:next(2)===1,weatherInterval:pick(),restartMode:next(7),stop:next(4)===0,entities:Array.from({length:next(5)},()=>({frozen:next(4)===0,terminated:next(4)===0,action:next(8)}))}));
const result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(serialize).join('\n')+'\n',encoding:'utf8',maxBuffer:256*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);let eventCount=0;
await mkdir(resolve(root,'work'),{recursive:true});
for(let i=0;i<cases.length;i++){
 const expected=oracle(cases[i]),actual=JSON.parse(lines[i]);
 try{assert.deepEqual(actual,expected)}catch(error){await writeFile(resolve(root,'work/engine-first-divergence.json'),JSON.stringify({case:i,input:serialize(cases[i]),expected,actual},null,2)+'\n');throw new Error(`Tick control diverged at case ${i}: ${error.message.slice(0,500)}`)}
 eventCount+=expected.events.length;
}
const summary={cases:cases.length,eventCount,sourceSha256:metadata.sha256,rawBitsExact:true,scope:'Full source tick orchestration under explicit fixture mechanics; not complete hero battles'};
await writeFile(resolve(root,'work/engine-trace-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
