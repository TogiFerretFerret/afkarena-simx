import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {bits} from './rng-trace.mjs';
const root=resolve(import.meta.dirname,'..');
if(!process.argv[2])throw new Error('Usage: node tools/check-skill.mjs BINARY');
const meta=JSON.parse(await readFile(resolve(root,'config/skill-translation.json'),'utf8'));
const source=await readFile(resolve(root,meta.source),'utf8');const definition=meta.functions.find(f=>f.name==='ed.Skill.update');
const text=source.slice(definition.start,definition.end);assert.equal(createHash('sha256').update(text).digest('hex'),definition.sha256);
let w,frames,c,used;
const ref=(v,list)=>v===undefined?'u':v===null?'n':list.indexOf(v);
const number=v=>v===undefined?'u':v===null?'n':bits(v);
function snapshot(){const s=w.s,u=s.caster;return{cd:bits(s.cd_remaining),unfreeze:number(s.unfreeze_time),delay:number(s.launcheffectdelay),casting:s.casting,elapsed:bits(s.current_phase_elapsed),phase:ref(s.current_phase,w.phases),event:ref(s.next_event,w.events),eventIndex:bits(s.next_event_idx),sound:ref(s.next_sound,w.sounds),soundIndex:bits(s.next_sound_idx),manual:u.manually_casting,current:ref(u.current_skill,[s]),play:s.playSound,info:w.infos.indexOf(s.info),activeQueue:w.queues.indexOf(w.active),mode:w.mode,eventTimes:w.events.map(e=>bits(e.Time)),queues:w.queues.map(q=>q.length)}}
function event(kind){frames.push({kind,state:snapshot()})}
function play(sound){event(`sound:${sound}`);if(c.action===4&&!used){used=true;w.active=[];w.queues.push(w.active);w.active.push(()=>play('new'))}if(c.action===12)w.s.next_sound_idx=1}
const context=createContext({ed:{battleEngine:{unfreeze:()=>event('unfreeze')},getDataTable:()=>{event('lookup');return{spark:{SoundName:'launch'},other:{SoundName:'launch'}}},playBattleEffect:play},clientCall:callback=>w.active.push(callback)});
const update=runInContext(`(${text})`,context);
function oracle(input){c=input;used=false;frames=[];w={mode:c.tb?'act_raid_monster':'stage',active:[],queues:[],events:[{Time:c.eventTime,Type:'Attack'},{Time:.1,Type:'Attack'},{Time:0,Type:'Other'}],sounds:[{Delay:c.soundDelay,SoundName:'first'},{Delay:.1,SoundName:'second'},{Delay:.2,SoundName:'third'}],infos:[{LaunchEffect:c.launch?'spark':undefined,LaunchEffectZOrder:0,LaunchEffectFixX:-0,LaunchEffectFixY:3},{LaunchEffect:'other',LaunchEffectZOrder:4,LaunchEffectFixX:5,LaunchEffectFixY:6}]};w.queues.push(w.active);w.phases=[{event_list:w.events.slice(0,2),sound_list:w.sounds.slice()},{event_list:[w.events[2],undefined],sound_list:[]}];
 const s={info:w.infos[0],casting:c.casting,playSound:c.play,cd_remaining:c.cd,current_phase_elapsed:c.elapsed,unfreeze_time:c.unfreeze,launcheffectdelay:c.delay,current_phase:w.phases[0],next_event:w.events[0],next_event_idx:c.nextIndex,next_sound:w.sounds[0],next_sound_idx:0,
 isMode_TB(){return w.mode==='act_raid_monster'||w.mode==='act_raid_monster_endless'},update_TB(){event('tb')},checkRegion(){event('region')},onAttackFrame(){event('attack');if(!used&&c.action!==4){used=true;switch(c.action){case 1:s.casting=false;break;case 2:s.current_phase=w.phases[1];break;case 3:s.next_event_idx+=1;break;case 5:s.caster.current_skill=null;break;case 6:s.playSound=false;break;case 7:s.launcheffectdelay=0;break;case 8:s.info=w.infos[1];break;case 9:w.events[0].Time=999;break;case 10:w.mode='act_raid_monster';break}}}};w.s=s;
 s.caster={current_skill:c.current?s:null,manually_casting:c.manual,getUnitScale(){event('scale');if(c.action===11)s.info=w.infos[1];return 1},actor:c.actor?{addEffect(effect,z,o){event(`effect:${effect}:${bits(z)}:${bits(o.x)}:${bits(o.y)}`)}}:null};
 event('enter');update.call(s,c.dt,c.cdDt,c.rawDt);event('after_update');let queue=w.active;while(queue.length)queue.shift()();event('after_drain');queue=w.active;while(queue.length)queue.shift()();event('after_second_drain');return{frames,used};
}
const optional=(kind,value)=>kind===0?undefined:kind===1?null:value;
const values=[0,-0,.125,.1,.2,-.1,1,-1,Infinity,-Infinity,NaN,Number.MIN_VALUE,Number.MAX_VALUE];
let seed=0x1234abcd;const next=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n};const pick=()=>values[next(values.length)];
const cases=Array.from({length:20000},()=>({action:next(13),tb:next(10)===0,casting:next(5)!==0,current:next(5)!==0,manual:next(2)===0,actor:next(2)===0,play:next(2)===0,launch:next(2)===0,dt:pick(),cdDt:pick(),rawDt:pick(),cd:pick(),elapsed:pick(),unfreeze:optional(next(3),pick()),delay:optional(next(3),pick()),eventTime:pick(),soundDelay:pick(),nextIndex:[0,1,-1,.5,NaN][next(5)]}));
function opt(v){return[v===undefined?0:v===null?1:2,bits(v??0)]}
const serialize=c=>[c.action,+c.tb,+c.casting,+c.current,+c.manual,+c.actor,+c.play,+c.launch,...[c.dt,c.cdDt,c.rawDt,c.cd,c.elapsed].map(bits),...opt(c.unfreeze),...opt(c.delay),bits(c.eventTime),bits(c.soundDelay),bits(c.nextIndex)].join(' ');
const result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(serialize).join('\n')+'\n',encoding:'utf8',maxBuffer:256*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);let count=0;
await mkdir(resolve(root,'work'),{recursive:true});
for(let i=0;i<cases.length;i++){const expected=oracle(cases[i]),actual=JSON.parse(lines[i]);try{assert.deepEqual(actual,expected)}catch(e){await writeFile(resolve(root,'work/skill-first-divergence.json'),JSON.stringify({case:i,input:serialize(cases[i]),expected,actual},null,2)+'\n');throw new Error(`Skill trace diverged at case ${i}: ${e.message.slice(0,300)}`)}count+=expected.frames.length;}
const summary={version:1,cases:cases.length,eventCount:count,sourceSha256:definition.sha256,rawBitsExact:true,scope:'Skill.update and deferred original callback bodies under explicit fixture mechanics; not full battle equivalence'};await writeFile(resolve(root,'work/skill-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
