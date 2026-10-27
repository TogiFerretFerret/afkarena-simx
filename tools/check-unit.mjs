import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createReadStream,openSync,closeSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createContext,runInContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {bits,fromBits} from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..');
if(!process.argv[2])throw new Error('Usage: node tools/check-unit.mjs RUNNER [--cases N] [--sample-snapshots]');
const countAt=process.argv.indexOf('--cases'),caseCount=countAt<0?20000:Number(process.argv[countAt+1]);
const sampleSnapshots=process.argv.includes('--sample-snapshots');
const metadata=JSON.parse(await readFile(resolve(root,'config/unit-translation.json'),'utf8'));
const source=await readFile(resolve(root,metadata.source),'utf8'),body=source.slice(metadata.start,metadata.end);
assert.equal(createHash('sha256').update(body).digest('hex'),metadata.sha256);
const util=await readFile(resolve(root,'src/srcmodule/game_util.js'),'utf8');
assert.equal(createHash('sha256').update(util.slice(638199,638235)).digest('hex'),'db312ebbb374bc1417e3fb1582d25c98b921a94b5b373564159fd76e87d7d740','Stale edpMult source');
assert.equal(createHash('sha256').update(util.slice(638314,638371)).digest('hex'),'2c6a18411d11be16eae9d8659081594c850c37f3612c4635df5d41f86b82c1f4','Stale edpDistanceSQ source');
let current;
const context=createContext({console:{log:message=>current.console(message)},isNaN,
 ed:{emUnitState_Idle:0,emUnitState_Walk:1,emUnitState_Attack:2,emUnitState_Fall:3,emUnitState_Dead:4,emUnitState_Dying:5,
  fixPosition:p=>current.fixPosition(p),battleEngine:{config:{localBot:false},freeze_level:0,getStageRect:()=>current.stageRect()}}});
context.ed.edpMult=runInContext(`(${util.slice(638199,638235)})`,context);
context.ed.edpDistanceSQ=runInContext(`(${util.slice(638314,638371)})`,context);
const update=runInContext(`(${body})`,context);
const numericFields=['hp','mp','camp','direction','height','z_speed','gravity_coef','delay_timer','speeder','dt_action','action_elapsed','action_duration','fall_delay','fall_time','knock_time','global_cd','thump_level','thump_reduce','enter_delay','dt','freeze','gravity','mspd','atkhast','msfix','hast','mpr','hpr','heal','dot','allmp','prmp','set_speeder'];
const attributeKeys=['MSPD','ATKHAST','MSFix','HAST','MPR','HPR','HEAL','DOTRATIO','AllMpRatio','PRMpRatio'];
const vectorKeys=['position','previous_position','walk_v','knockup_v','velocity','knockup_accel','forceDestination','destination'];
const numberKeys=['camp','hp','mp','direction','height','gravityCoef','speeder','dt_action','action_elapsed','action_duration','fall_fronzenTime','knockup_time','global_cd','thumpResistanceLevel'];
const optionalKeys=['zSpeed','delayTerminateTimer','fall_fronzenDelay','thumpResistanceReduce','enterDelayTimer'];
function effects(mask){return{frozen:!!(mask&1),motionless:!!(mask&2),immoblilize:!!(mask&4),fix:!!(mask&8),disableAI:!!(mask&16),stopBuff:!!(mask&32),noHPR:!!(mask&64),unheal:!!(mask&128)}}
function effectMask(e){return Number(e.frozen)|(Number(e.motionless)<<1)|(Number(e.immoblilize)<<2)|(Number(e.fix)<<3)|(Number(e.disableAI)<<4)|(Number(e.stopBuff)<<5)|(Number(e.noHPR)<<6)|(Number(e.unheal)<<7)}
function oracle(c){
 const {n,flags,actions,optional,aliases}=c;
 const vectors=c.vectors.map(v=>v.slice()),vectorIds=new WeakMap(vectors.map((v,i)=>[v,i]));
 const register=v=>{if(v===null||v===undefined)return null;if(!vectorIds.has(v)){vectorIds.set(v,vectors.length);vectors.push(v);}return vectorIds.get(v)};
 const fx=c.effects.map(effects),events=[],skills=[],buffs=[];let terminated=0;
 const makeUnit=idx=>{
  const u={name:`u${idx}`,state:0,isAlive(){return this.state!==4&&this.state!==5},config:{is_summoned:false,is_boss:false},camp:n[2],hp:n[0],mp:n[1],attribs:Object.fromEntries(attributeKeys.map((key,i)=>[key,n[22+i]])),buff_effects:fx[idx],direction:n[3],height:n[4],gravityCoef:n[6],speeder:n[8],dt_action:n[9],action_elapsed:n[10],action_duration:n[11],fall_fronzenTime:n[13],knockup_time:n[14],global_cd:n[15],thumpResistanceLevel:n[16],zSpeed:null,delayTerminateTimer:null,fall_fronzenDelay:null,thumpResistanceReduce:null,enterDelayTimer:null,current_skill:null,basic_skill:null,skill_list:[],buff_list:[],action_name:null,action_loop:false,knock_state:false,knock_notFall:false,walkIgnoreRect:false,frozen_model:false};
  const refs=[vectors[1],vectors[2],vectors[3],vectors[4],vectors[5],vectors[6],vectors[7],vectors[8]];
  for(let i=0;i<vectorKeys.length;i++)Object.defineProperty(u,vectorKeys[i],{enumerable:true,get:()=>refs[i],set:v=>{register(v);refs[i]=v}});
  return u;
 };
 const units=[makeUnit(0),makeUnit(1),makeUnit(2)],u=units[0];
 for(let i=1;i<3;i++){units[i].hp=n[0]+10*i;units[i].mp=n[1]+20*i;units[i].position=vectors[i===1?9:1];units[i].state=flags&(i===1?1024:2048)?4:0;}
 u.state=c.state;u.config.is_summoned=!!(flags&1);u.config.is_boss=!!(flags&2);u.action_loop=!!(flags&4);u.knock_state=!!(flags&8);u.knock_notFall=!!(flags&16);u.walkIgnoreRect=!!(flags&32);u.frozen_model=!!(flags&64);u.action_name=[null,'atk','','other'][c.action];
 optionalKeys.forEach((key,i)=>{u[key]=optional&(1<<i)?n[[5,7,12,17,18][i]]:null});
 if(aliases&1)u.velocity=vectors[3];if(aliases&2)u.velocity=vectors[4];if(aliases&4)u.velocity=vectors[1];if(aliases&8)u.previous_position=vectors[1];if(aliases&16)u.knockup_accel=vectors[4];if(aliases&32)u.velocity=vectors[0];if(aliases&64)u.forceDestination=vectors[1];if(aliases&128)units[1].position=vectors[1];
 for(let i=0;i<3;i++)skills.push({id:i,caster:u,info:{SetSpeeder:optional&32?n[32]:null},lockActionSpeeder:!!(c.skillFlags&1),lockMSFix:!!(c.skillFlags&2),lockUnitDirection:!!(c.skillFlags&4),target:units[1],update(a,d,r){event(`update_skill:${i}:${bits(a)}:${bits(d)}:${bits(r)}`);if(i===0){if(actions&16&&u.skill_list.length)u.skill_list.shift();if(actions&32&&!u.skill_list.includes(skills[2]))u.skill_list.push(skills[2]);if(actions&32768)u.action_name='after';}},onPhaseFinished(){event(`phase_finished:${i}`);if(actions&65536)u.current_skill=null}});
 for(const unit of units)unit.basic_skill=skills[0];u.current_skill=c.current<3?skills[c.current]:null;u.skill_list=skills.slice(0,c.skillCount);
 for(let i=0;i<3;i++)buffs.push({id:i,clearOnCasterDeathFlag:i%2===0,caster:units[1],timer:5+i,effectsRelatedNumber:i===0?{unheal:1}:i===1?{unheal:0}:{},hasEffectOrNot(effect){event(`buff_has_effect:${i}:${effect}`);if(effect==='unheal'&&actions&2048)this.effectsRelatedNumber.unheal=2;return i%2===0},update(dt){event(`update_buff:${i}:${bits(dt)}`);if(i===0&&actions&64&&u.buff_list.length)u.buff_list.shift()},updateHPRDamage(dt){event(`buff_hpr:${i}:${bits(dt)}`);if(i===0&&actions&128&&u.buff_list.length)u.buff_list.shift()}});
 u.buff_list=buffs.slice(0,c.buffCount);
 function snapshot(){return{units:units.map(x=>({s:x.state,f:Number(x.config.is_summoned)|(Number(x.config.is_boss)<<1)|(Number(x.action_loop)<<2)|(Number(x.knock_state)<<3)|(Number(x.knock_notFall)<<4)|(Number(x.walkIgnoreRect)<<5)|(Number(x.frozen_model)<<6),fx:fx.indexOf(x.buff_effects),n:numberKeys.map(key=>bits(x[key])),o:optionalKeys.map(key=>x[key]===null?null:bits(x[key])),v:vectorKeys.map(key=>register(x[key])),a:attributeKeys.map(key=>bits(x.attribs[key])),current:x.current_skill?.id??null,basic:x.basic_skill?.id??null,action:x.action_name,skills:x.skill_list.map(s=>s.id),buffs:x.buff_list.map(b=>b.id)})),vectors:vectors.map(v=>Array.from(v,bits)),effects:fx.map(effectMask),skills:skills.map(s=>[s.info.SetSpeeder===null?null:bits(s.info.SetSpeeder),s.lockActionSpeeder,s.lockMSFix,s.lockUnitDirection,units.indexOf(s.target)]),buffs:buffs.map(b=>[b.clearOnCasterDeathFlag,units.indexOf(b.caster),b.timer===null?null:bits(b.timer),b.effectsRelatedNumber.unheal===undefined?null:bits(b.effectsRelatedNumber.unheal)]),gravity:bits(context.ed.gravity),freeze:bits(context.ed.battleEngine.freeze_level),local:context.ed.battleEngine.config.localBot}}
 function event(kind){events.push(c.trace?{kind,state:snapshot()}:{kind})}
 u.terminate=()=>{event('terminate:0');terminated++};
 u.onActionFinished=()=>{event('action_finished:0');if(actions&1)u.state=4;if(actions&16384)u.action_name='next'};
 u.addBuff=(tid,caster)=>{event(`add_buff:0:${tid}:${units.indexOf(caster)}`);return buffs[0]};
 u.isMode_TB=()=>{event('is_turn_based:0');return!!(flags&256)};
 u.fall=()=>{event('fall:0');u.state=3;if(actions&2)u.velocity=[9,-3]};
 u.ai={castSkillWhenControlled(){event('cast_when_controlled:0')},update(dt){event(`update_ai:0:${bits(dt)}`);if(actions&8)u.buff_effects=fx[1]}};
 u.isPet=()=>{event('is_pet:0');if(actions&1024)u.buff_effects=fx[1];return!!(flags&512)};
 u.recheckManualCast=()=>{event('recheck_manual:0');if(actions&256)u.state=4};
 u.getTransferMpTarget=()=>{event('transfer_mp:0');return units[1]};
 for(let i=0;i<3;i++){
  units[i].setMp=(value,source)=>{event(`set_mp:${i}:${bits(value)}:${units.indexOf(source)}`);units[i].mp=value;if(actions&512)units[i].state=4};
  units[i].setHp=value=>{event(`set_hp:${i}:${bits(value)}`);units[i].hp=value};
  units[i].battledata={addRestore:value=>event(`add_restore:${i}:${bits(value)}`)};
 }
 u.getTransferTarget=()=>{event('transfer_hp:0');return units[2]};
 context.ed.gravity=n[21];context.ed.edpZero=vectors[0];context.ed.battleEngine.freeze_level=n[20];context.ed.battleEngine.config.localBot=!!(flags&128);
 current={stageRect(){event('stage_rect');if(actions&4)u.velocity=[123,-45];if(actions&8192)u.position=[450,0];return{minX:-400,maxX:400}},fixPosition(position){event(`fix_position:${register(position)}`);return[-1,2]},console(message){if(message==='u0 position error')event('console:position_error');else if(message==='u0 position error v2')event('console:position_error_v2');else throw new Error(`Unexpected source console message:${message}`)}};
 let error=null;try{update.call(u,n[19])}catch(e){error=e.message}
 return{events,final:snapshot(),terminated,error};
}
let random=0x6839231;
const next=n=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%n};
function testcase(index){
 const n=[100,10,1,1,2,3,1,0.1,1,0,0.5,0.6,0.1,0.4,0.1,1,2,0.1,0.5,.125,0,-100,5,10,.1,20,2,3,5,.1,.2,10,15];
 for(const j of [0,1,3,4,5,7,10,11,12,13,14,15,16,17,18,22,23,24,25,26,27,28,29,30,31,32])n[j]=(next(1601)-800)/4;
 n[19]=[0,-0,.125,.25,1,-.125][next(6)];n[20]=[0,1,-1][next(3)];
 const c={trace:!sampleSnapshots||index<512,actions:next(131072),flags:next(4096),state:next(7),optional:next(64),action:next(4),current:next(4),skillCount:next(4),buffCount:next(4),effects:[next(256),next(256),next(256)],aliases:next(256),skillFlags:next(8),n,vectors:Array.from({length:10},()=>[(next(4001)-2000)/4,(next(4001)-2000)/4])};
 c.vectors[0]=[0,0];
 if(index<32){c.state=index%7;c.flags|=1;c.optional|=2;c.action=1;c.n[7]=index%2?1:NaN;c.n[10]=2;c.n[11]=1;c.n[19]=.125;}
 if(index===32||index===33){c.state=0;c.actions=0;c.flags=0;c.optional=63;c.n[24]=NaN;c.n[29]=NaN;c.effects=[0,0,0];}
 if(index>=34&&index<=38){
  Object.assign(c,{actions:0,flags:0,state:0,optional:63,action:0,current:3,skillCount:0,buffCount:0,effects:[0,0,0],aliases:0,skillFlags:0});
  c.n=[100,10,1,1,2,3,1,.1,1,0,.5,.6,.1,.4,0,1,0,.1,.5,.125,0,-100,5,10,.1,20,2,3,5,.1,.2,10,15];
  c.vectors=Array.from({length:10},()=>[0,0]);c.vectors[3]=[10,0];
  if(index===34){c.n[0]=-0;c.n[26]=0;c.n[27]=0;}
  if(index===35){c.flags=128;c.n[19]=0;c.vectors[1]=[25000,0];}
  if(index===36){c.flags=512;c.actions=1024;c.n[20]=1;c.effects=[0,16,0];}
  if(index===37){c.actions=128;c.buffCount=3;}
  if(index===38){c.actions=8|64;c.buffCount=3;c.flags=1024;c.effects=[0,32,0];}
 }
 return c;
}
function serialize(c){return[+c.trace,c.actions,c.flags,c.state,c.optional,c.action,c.current,c.skillCount,c.buffCount,...c.effects,c.aliases,c.skillFlags,...c.n.map(bits),...c.vectors.flatMap(v=>v.map(bits))].join(' ')}
await mkdir(resolve(root,'work'),{recursive:true});
const cases=Array.from({length:caseCount},(_,i)=>testcase(i));
const path=resolve(root,'work/unit-native.trace'),fd=openSync(path,'w');let result;
try{result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(serialize).join('\n')+'\n',encoding:'utf8',stdio:['pipe',fd,'pipe']});}finally{closeSync(fd)}
if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
let index=0,eventCount=0,snapshotEvents=0;const hookCounts={};
for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
 const expected=oracle(cases[index]),actual=JSON.parse(line);
 try{assert.deepEqual(actual,expected)}catch(error){await writeFile(resolve(root,'work/unit-first-divergence.json'),JSON.stringify({case:index,input:serialize(cases[index]),expected,actual},null,2)+'\n');throw new Error(`Unit.update diverged case${index}; see work/unit-first-divergence.json: ${error.message.slice(0,400)}`)}
 eventCount+=expected.events.length;if(cases[index].trace)snapshotEvents+=expected.events.length;index++;
 for(const event of expected.events){const key=event.kind.split(':')[0];hookCounts[key]=(hookCounts[key]??0)+1;}
}
assert.equal(index,cases.length);
const report={version:1,sourceName:metadata.sourceName,sourceSha256:metadata.sha256,binarySha256:createHash('sha256').update(await readFile(resolve(process.argv[2]))).digest('hex'),cases:index,eventCount,snapshotEvents,hookCounts,rawBitsExact:true,referenceRuntime:process.version,scope:'Actual Unit.update source control, numeric state and aliasing under scripted mechanics hooks; not complete battles'};
await rm(resolve(root,'work/unit-first-divergence.json'),{force:true});
await writeFile(resolve(root,'work/unit-differential-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
