import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
assert.ok(process.argv[2], 'Usage: node tools/check-ai-update.mjs RUNNER');
const file=await readFile(resolve(root,'src/srcmodule/game_battle.js'),'utf8');
const functions=[
 {name:'ed.Ai.update',start:3665,end:4257,sha256:'1f0e7b59d630d832f20ca1ec5d3af7074e99a885c425ee0a317b27386ef2fa3c'},
 {name:'ed.Ai.castSkillWhenControlled',start:6169,end:6609,sha256:'5a0e9c0272d8962440d57672eaad94ce666057d946b34a45a96c7ef60b80073e'},
];
const source=functions.map(def=>{const text=file.slice(def.start,def.end);assert.equal(createHash('sha256').update(text).digest('hex'),def.sha256);return runInNewContext(`(${text})`,{ed:{emUnitState_Idle:0,emUnitState_Walk:1}})});
const castValues=[undefined,null,false,'cast','trigger'];
function oracle(s){
 const calls=[],units=Array.from({length:7},(_,id)=>({id})),vectors=Array.from({length:7},(_,id)=>({id})),skills=[],lists=[];let count=0;
 const unit=id=>id===7?null:units[id],vector=id=>id===7?null:vectors[id];
 const owner=units[0];Object.assign(owner,{state:s.state,buff_effects:{fear:s.fear},fearTarget:unit(s.fearTarget),forceDestination:vector(s.force),destination:vector(s.destination),manual:s.manual,config:{is_turnbased:s.turnbased},can_cast_manual:castValues[s.cast],will_cast_manual:s.will});
 const ai={owner,target:unit(s.target)};
 function state(){return{state:owner.state,fear:owner.buff_effects.fear,fearTarget:owner.fearTarget?.id??null,force:owner.forceDestination?.id??null,destination:owner.destination?.id??null,manual:owner.manual,manualSkill:owner.manualSkill?.id??null,currentSkill:owner.current_skill?.id??null,turnbased:owner.config.is_turnbased,target:ai.target?.id??null,canCast:castValues.indexOf(owner.can_cast_manual),willCast:owner.will_cast_manual,list:lists.indexOf(owner.skill_list),lists:lists.map(l=>l.map(x=>x.id)),ignore:skills.map(x=>x.info.IgnoreControllable)}}
 function call(kind,id=null,target=null){
  const before=state(),answer=!!(s.answers>>(count%16)&1);count++;
  if(s.mask&1)ai.target=units[((ai.target?.id??0)+1)%7];
  if(s.mask&2)owner.current_skill=skills[((owner.current_skill?.id??0)+1)%s.n];
  if(s.mask&4)owner.manual=!owner.manual;
  if(s.mask&8)owner.skill_list=lists[1-lists.indexOf(owner.skill_list)];
  if(s.mask&16){const l=count%2,i=count%s.n;lists[l][i]=skills[(lists[l][i].id+1)%s.n]}
  if(s.mask&32)owner.manualSkill=skills[((owner.manualSkill?.id??0)+1)%s.n];
  if(s.mask&64)owner.config.is_turnbased=!owner.config.is_turnbased;
  if(s.mask&128){owner.forceDestination=vectors[((owner.forceDestination?.id??0)+1)%7];owner.destination=vectors[((owner.destination?.id??0)+1)%7]}
  if(s.mask&256){const i=count%s.n;skills[i].info.IgnoreControllable=!skills[i].info.IgnoreControllable}
  if(s.mask&512){owner.state=(owner.state+1)%3;owner.buff_effects.fear=!owner.buff_effects.fear}
  calls.push({kind,id,target,answer,before,after:state()});return answer;
 }
 for(let id=0;id<s.n;id++)skills.push({id,info:{IgnoreControllable:s.ignore[id]},canCastWithTarget:t=>call('can',id,t?.id??null),willCast:()=>call('will',id),trigger:()=>call('trigger',id)});
 for(const l of s.lists)lists.push(l.map(id=>skills[id]));owner.skill_list=lists[s.list];owner.manualSkill=s.ms===s.n?null:skills[s.ms];owner.current_skill=s.cs===s.n?null:skills[s.cs];
 ai.walkAwayFrom=t=>call('away',null,t.id);ai.walkTo=t=>call(vectors.includes(t)?'walkVector':'walkUnit',null,t.id);
 ai.searchTarget=()=>{call('search');return{target:unit(s.search)}};ai.searchTurnBasedTarget_TB=()=>{call('searchTB');return{target:unit(s.search)}};
 ai.findSkillToCast=()=>{call('find');return s.found===s.n?null:skills[s.found]};owner.castSkill=(skill,target)=>call('cast',skill.id,target?.id??null);
 owner.isOutOfStage=()=>call('outside');owner.idle=()=>call('idle');ai.checkTrigger=()=>call('check');
 source[s.kind].call(ai,.125);return{state:state(),calls};
}
function serialize(s){return[s.kind,s.n,s.state,+s.fear,s.fearTarget,s.force,s.destination,+s.manual,s.ms,s.cs,+s.turnbased,s.target,s.cast,+s.will,s.list,...s.lists.flat(),...s.ignore.map(Number),s.mask,s.answers,s.search,s.found].join(' ')}
let random=0x950a722;function next(n){random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%n}
const cases=Array.from({length:20000},()=>{const n=1+next(6),kind=next(2),mask=next(1024);return{kind,n,state:next(3),fear:!!next(2),fearTarget:next(8),force:next(5)?7:next(7),destination:next(5)?7:next(7),manual:!!next(2),ms:next(n+1),cs:kind===0?next(n):next(n+1),turnbased:!!next(2),target:next(8),cast:next(5),will:!!next(2),list:next(2),lists:Array.from({length:2},()=>Array.from({length:n},()=>next(n))),ignore:Array.from({length:n},()=>!!next(2)),mask,answers:next(65536),search:next(8),found:next(n+1)}});
const result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(serialize).join('\n')+'\n',encoding:'utf8',maxBuffer:256*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);let eventCount=0;const hookCounts={};await mkdir(resolve(root,'work'),{recursive:true});
for(let i=0;i<cases.length;i++){const expected=oracle(cases[i]),actual=JSON.parse(lines[i]);try{assert.deepEqual(actual,expected)}catch(error){await writeFile(resolve(root,'work/ai-update-first-divergence.json'),JSON.stringify({case:i,input:serialize(cases[i]),expected,actual},null,2)+'\n');throw new Error(`Ai controller diverged case ${i}: ${error.message.slice(0,500)}`)}eventCount+=expected.calls.length;for(const call of expected.calls)hookCounts[call.kind]=(hookCounts[call.kind]??0)+1}
const report={version:1,cases:cases.length,eventCount,hookCounts,rawBitsExact:true,functions,scope:'Ai.update and castSkillWhenControlled source control with mutating fixture callbacks and full controller snapshots; stable owner, dense fixed-length skill lists; not full battles'};
await writeFile(resolve(root,'work/ai-update-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
