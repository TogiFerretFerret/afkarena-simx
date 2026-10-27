import { readFile,mkdir,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { bits } from './rng-trace.mjs';
const root=resolve(import.meta.dirname,'..');
const path=resolve(root,'src/srcmodule/game_battle.js');const original=await readFile(path,'utf8');const source=original.slice(4512,5369);
const sha256=createHash('sha256').update(source).digest('hex');
const metadata={version:1,source:'src/srcmodule/game_battle.js',sourceName:'ed.Ai.searchTarget',start:4512,end:5369,sha256,domain:['Plain dense mutable Number-valued positions and boolean targeting flags','Candidate order is preserved; tied distances retain source selection order','Force-target instanceof/isAlive/taunt priority is preserved','Source range, shape and alive-list calls are explicit native hooks; test hooks do not mutate state','Numeric inputs in this corpus are finite; NaN inputs are not assumed unreachable by the whole game'],formalProof:false};
await writeFile(resolve(root,'config/ai-targeting.json'),JSON.stringify(metadata,null,2)+'\n');
let current,calls;
function Unit(){}
const ed={Unit,math_huge:Number.MAX_VALUE,edpDistanceSQ:(a,b)=>{const x=a[0]-b[0],y=a[1]-b[1];return x*x+y*y},battleEngine:{foreachAliveUnit:()=>{calls.push('units');return current.list.map(id=>current.units[id])}}};
const search=runInNewContext(`(${source})`,{ed});
function oracle(s){calls=[];const units=s.units.map((u,id)=>Object.assign(u.is_unit?new Unit():{}, {id,position:[u.x,u.y],camp:u.camp,foecamp:u.foe_camp,buff_effects:{taunted:u.taunted,pursue:u.pursue,untargetable:u.untargetable,lowPriority:u.low_priority},isAlive(){calls.push(`alive:${id}`);return u.alive}}));for(let i=0;i<units.length;i++)units[i].forceTarget=s.units[i].force_target===s.units.length?null:units[s.units[i].force_target];current={units,list:s.list};const object={owner:units[s.owner],getBasicShapeInfo(){calls.push('shape');return{shape:s.rectangle?'rectangle':'circle',arg1:s.arg1}},targetInBasicRange(u){calls.push(`range:${u.id}`);return s.units[u.id].range}};const result=search.call(object);return{target:result.target?.id??null,distance:bits(result.distanceSQ),calls:[...calls]}}
function serialize(s){return[s.units.length,s.owner,+s.rectangle,bits(s.arg1),bits(Number.MAX_VALUE),...s.units.flatMap(u=>[bits(u.x),bits(u.y),bits(u.camp),bits(u.foe_camp),+u.is_unit,+u.alive,+u.untargetable,+u.low_priority,+u.taunted,+u.pursue,u.force_target,+u.range]),s.list.length,...s.list].join(' ')}
let random=0x741239;const next=n=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)%n};
const cases=[];for(let i=0;i<20000;i++){const n=1+next(12),owner=next(n);const units=Array.from({length:n},()=>({x:(next(2001)-1000)/8,y:(next(2001)-1000)/8,camp:next(3)-1,foe_camp:next(3)-1,is_unit:next(5)!==0,alive:next(4)!==0,untargetable:next(5)===0,low_priority:next(3)===0,taunted:next(7)===0,pursue:next(7)===0,force_target:next(n+1),range:next(2)===0}));cases.push({units,owner,rectangle:next(2)===0,arg1:next(500)/4,list:Array.from({length:next(20)},()=>next(n))});}
const binary=process.argv[2]??resolve(root,'work/check-ai');const result=spawnSync(resolve(binary),[],{input:cases.map(serialize).join('\n')+'\n',encoding:'utf8',maxBuffer:32*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);let callbackCount=0;for(let i=0;i<cases.length;i++){const expected=oracle(cases[i]),actual=JSON.parse(lines[i]);try{assert.deepEqual(actual,expected)}catch(error){await writeFile(resolve(root,'work/ai-first-divergence.json'),JSON.stringify({case:i,input:serialize(cases[i]),expected,actual},null,2));throw error;}callbackCount+=expected.calls.length;}
const report={cases:cases.length,callbackCount,rawBitsExact:true,sourceSha256:sha256,scope:'Native ordered searchTarget with source callbacks; not full battles'};await mkdir(resolve(root,'work'),{recursive:true});await writeFile(resolve(root,'work/ai-targeting-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
