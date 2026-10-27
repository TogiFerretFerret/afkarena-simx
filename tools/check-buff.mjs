import {readFile,writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {bits} from './rng-trace.mjs';
const metadata=JSON.parse(await readFile(new URL('../config/buff-translation.json',import.meta.url)));
const source=await readFile(new URL('../'+metadata.source,import.meta.url),'utf8');
let active;
const funcs=metadata.functions.map(f=>{const text=source.slice(f.start,f.end);assert.equal(createHash('sha256').update(text).digest('hex'),f.sha256);return runInNewContext(`(${text})`,{ed:{battleEngine:{hpChangeEventToAll:(u,v,c,k)=>active.hp(u,v,c,k)},calcCtrlBuffTimerCoef:(o,c)=>active.coef('ctrl',o,c),calcPosBuffTimerCoef:(o,c)=>active.coef('pos',o,c)}})});
function oracle({n,f}){
 const events=[];let b;
 const units=[0,1,2].map(id=>({id,camp:id===1&&!(f[0]&2)?-1:1,config:{isFieldNpc:id===1&&!!(f[0]&4)},what:'Unit',hp:id===2?n[7]:n[3],attribs:{HP:n[4],HEAL:id===2?n[8]:n[5],DOTRATIO:n[6]}}));
 function snapshot(){return `${b.owner.id}:${b.caster.id}:${b.timer===null?'n':b.timer===undefined?'u':bits(b.timer)}:${units.map(u=>bits(u.hp)).join(':')}`}
 const event=s=>events.push(`${s}|${snapshot()}`);
 function mutate(){if(f[0]&32)b.timer=99;if(f[0]&64)b.caster=units[2];if(f[0]&128)b.owner=units[2]}
 for(const u of units){u.removeBuff=()=>event(`remove:${u.id}`);u.getTransferTarget=()=>{event('transfer');mutate();return units[f[0]&16?2:0]};u.battledata={addHeal(v){event(`heal:${u.id}:${bits(v)}`);mutate()},addDamage(v,c,o,k){event(`damage:${u.id}:${bits(v)}:${c.id}:${o.id}:${k}`);mutate()},addRealBearDamage(v,c,o){event(`real:${u.id}:${bits(v)}:${c.id}:${o.id}`)},addBearDamage(v){event(`bear:${u.id}:${bits(v)}`)}}}
 b={owner:units[0],caster:units[1],timer:f[1]===0?null:f[1]===1?undefined:n[0],buffIncHPR:n[1],info:{AffectedByAttr:!!(f[0]&256)},isMode_TB(){event('turn');return!!(f[0]&1)},update_TB(dt){event(`tb:${bits(dt)}`)},isCrlEftConflictWithUncontrollable(){event('conflict');mutate();return!!(f[0]&8)}};
 active={hp(u,v,c,k){event(`hp:${u.id}:${bits(v)}:${c.id}:${k}`)},coef(k,o,c){event(`${k}:${o.id}:${c.id}`);mutate();return n[9]}};
 funcs[f[2]].call(b,n[2]);return{events,state:snapshot()};
}
let state=0x72ad945;const next=n=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%n};
const values=[0,-0,1,-1,.125,.1,100,-100,110,500,1e-10];
const cases=Array.from({length:20000},()=>({n:Array.from({length:10},()=>values[next(values.length)]),f:[next(512),next(3),next(2)]}));
const result=spawnSync(process.argv[2],[],{input:cases.map(c=>[...c.n.map(bits),...c.f].join(' ')).join('\n')+'\n',encoding:'utf8',maxBuffer:64*1024*1024});
assert.equal(result.status,0,result.stderr||result.error?.message);
const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);let events=0;
for(let i=0;i<cases.length;i++){const expected=oracle(cases[i]),actual=JSON.parse(lines[i]);try{assert.deepEqual(actual,expected)}catch(e){await writeFile('work/buff-first-divergence.json',JSON.stringify({case:i,input:cases[i],expected,actual},null,2));throw new Error(`Buff differential case ${i}: ${e.message}`)}events+=expected.events.length}
const report={cases:cases.length,events,rawBitsExact:true,source:metadata.functions,scope:'Buff update/HPR control with live identities and mutating required fixture hooks; finite numeric inputs plus null/undefined timers; not integrated full battles'};
await writeFile('work/buff-differential-summary.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
