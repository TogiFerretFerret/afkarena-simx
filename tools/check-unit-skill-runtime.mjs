import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createReadStream,createWriteStream,openSync,closeSync,writeSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {createContext,runInContext,constants} from 'node:vm';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {bits} from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags))throw Error('Run with pinned oracle flags: '+profile.rawBitReferenceFlags.join(' '));
const unitPin=JSON.parse(await readFile(resolve(root,'config/unit-translation.json'))),skillPin=JSON.parse(await readFile(resolve(root,'config/skill-translation.json')));
const source=await readFile(resolve(root,unitPin.source),'utf8'),unitText=source.slice(unitPin.start,unitPin.end),skillDefinition=skillPin.functions.find(f=>f.name==='ed.Skill.update'),skillText=source.slice(skillDefinition.start,skillDefinition.end);
assert.equal(sha(unitText),unitPin.sha256);assert.equal(sha(skillText),skillDefinition.sha256);
const resourcesPin=JSON.parse(await readFile(resolve(root,'config/unit-resources-translation.json')));
const resourceTexts=resourcesPin.functions.map(f=>{const text=source.slice(f.start,f.end);assert.equal(sha(text),f.sha256);return text;});
let state,frames,input,used;
const reference=(v,list)=>v===undefined?'u':v===null?'n':list.indexOf(v),optional=v=>v===undefined?'u':v===null?'n':bits(v);
function snapshot(){const u=state.unit,s=state.skill;return{
 unit:[bits(u.hp),bits(u.mp),bits(u.global_cd),reference(u.current_skill,[s]),bits(u.speeder),bits(u.dt_action),bits(u.action_elapsed),u.position.map(bits),u.previous_position.map(bits),u.velocity.map(bits),u.skill_list.map(x=>reference(x,[s]))],
 skill:[bits(s.cd_remaining),bits(s.current_phase_elapsed),s.casting,u.manually_casting,state.infos.indexOf(s.info),reference(s.next_event,state.events),bits(s.next_event_idx),reference(s.next_sound,state.sounds),bits(s.next_sound_idx),s.playSound,optional(s.unfreeze_time),optional(s.launcheffectdelay)],
 lastTick:bits(u.lastHpChangeTick),freeze:bits(state.freeze),queues:state.queues.map(q=>q.length),active:state.queues.indexOf(state.active)
};}
function event(kind){frames.push({kind,state:snapshot()});}
const sentinel={label:'exact-runtime-fixture-sentinel'};
function once(action,body){if(input.action===action&&!used){used=true;body();}}
function play(name){event('sound:'+name);once(5,()=>{state.unit.mp+=5;state.unit.global_cd=-7;state.unit.current_skill=null;event('mutate:sound-shared');});once(6,()=>{state.skill.next_sound_idx=1;event('mutate:sound-index');});once(9,()=>{state.unit.global_cd=23;event('mutate:sound-throw');throw sentinel;});once(11,()=>{state.active=[];state.queues.push(state.active);state.active.push(()=>play('nested'));event('mutate:queue-replacement');});}
const context=createContext(constants.DONT_CONTEXTIFY);
context.ed={emUnitState_Idle:0,emUnitState_Walk:1,emUnitState_Attack:2,emUnitState_Fall:3,emUnitState_Dead:4,emUnitState_Dying:5,gravity:-10,
 edpZero:[0,0],edpMult:(p,n)=>[p[0]*n,p[1]*n],edpDistanceSQ:(a,b)=>(a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1]),fixPosition:p=>p,
 btLog:{setMP(){event('btlog-mp');once(16,()=>{state.skill.info=state.infos[1];state.skill.casting=false;event('mutate:resource-skill');});},setHp(){event('btlog-hp');once(17,()=>{state.skill.next_sound_idx=1;event('mutate:resource-throw');throw sentinel;});}},
 battleEngine:{config:{localBot:false},get ticks(){return state.frame;},get freeze_level(){return state.freeze;},getStageRect(){event('rect');return{minX:-400,maxX:400};},getMode:()=> 'stage',unfreeze(){event('unfreeze');once(4,()=>{state.unit.mp=-0;state.freeze=0;event('mutate:unfreeze-shared');});}},
 getDataTable(){event('lookup');return{spark:{SoundName:'launch'}};},playBattleEffect:play};
context.clientCall=callback=>state.active.push(callback);
const unitUpdate=runInContext('('+unitText+')',context),skillUpdate=runInContext('('+skillText+')',context),resourceMethods=resourceTexts.map(text=>runInContext('('+text+')',context));
export function createFixture(c){input=c;used=false;frames=[];
 const infos=[{SetSpeeder:25.5,LaunchEffect:c.action===15?'spark':undefined,LaunchEffectZOrder:0,LaunchEffectFixX:-0,LaunchEffectFixY:3},{SetSpeeder:0}];
 const events=[{Time:0,Type:'Attack'},{Time:0.1,Type:'Attack'}],sounds=[{Delay:0,SoundName:'first'},{Delay:0.1,SoundName:'second'},{Delay:0.2,SoundName:'third'}];
 const phase={event_list:events,sound_list:sounds};
 const skill={info:infos[0],caster:null,lockActionSpeeder:false,lockMSFix:false,lockUnitDirection:false,target:null,casting:true,playSound:true,
 cd_remaining:2,current_phase_elapsed:0,current_phase:phase,next_event:events[0],next_event_idx:0,next_sound:sounds[0],next_sound_idx:0,
 unfreeze_time:c.unfreeze,launcheffectdelay:c.action===15?0:undefined,
 isMode_TB:()=>false,checkRegion(){event('region');once(14,()=>{state.unit.current_skill=null;event('mutate:region-throw');throw sentinel;});},
 onAttackFrame(){event('attack');once(1,()=>{state.unit.mp=37;state.unit.global_cd=-0;state.unit.current_skill=null;event('mutate:attack-shared');});once(2,()=>{skill.casting=false;event('mutate:casting');});once(3,()=>{state.unit.global_cd=9;event('mutate:global-cd');});once(7,()=>{skill.info=infos[1];event('mutate:info');});once(8,()=>{state.unit.mp=39;event('mutate:attack-throw');throw sentinel;});once(10,()=>{state.unit.skill_list.length=0;event('mutate:skill-list');});},
 update(a,b,r){event('update:'+bits(a)+':'+bits(b)+':'+bits(r));return skillUpdate.call(this,a,b,r);},onPhaseFinished(){throw Error('unexpected phase finish');}};
 const u={state:0,name:'combined-fixture',config:{is_boss:false,is_summoned:false},info:{MP:1000},attribs:{HP:200,MSPD:c.mspd,ATKHAST:c.atkhast,MSFix:0,HAST:c.hast,MPR:c.mpr,HPR:c.hpr,HEAL:15,DOTRATIO:0.25,AllMpRatio:0.1,PRMpRatio:25},
 buff_effects:{frozen:false,motionless:false,immoblilize:false,fix:false,disableAI:false,stopBuff:false,noHPR:false,unheal:false,noAddMp:false,transferMp:false,transferHeal:false},
 hp:100,mp:c.mp,lastHpChangeTick:-1,camp:1,current_skill:skill,basic_skill:skill,speeder:99,dt_action:99,
 action_name:c.action===12?'atk':null,action_elapsed:c.action===12?1.5:0,action_duration:1,action_loop:false,
 position:[0,0],previous_position:[1,2],walk_v:[0.125,-0.25],knockup_v:[0,0],velocity:[0,0],direction:1,height:0,zSpeed:null,gravityCoef:1,knockup_time:0,knock_state:false,walkIgnoreRect:false,forceDestination:null,destination:null,
 global_cd:c.global,skill_list:[skill],buff_list:[],frozen_model:false,thumpResistanceLevel:0,thumpResistanceReduce:null,enterDelayTimer:null,
 manually_casting:true,petSkillCasting:false,morph:false,actor:null,
 isAlive(){return true;},isMode_TB(){event('turnbased');return false;},isPet(){event('pet');return false;},
 onActionFinished(){event('action-finished');once(12,()=>{u.mp=43;event('mutate:action-throw');throw sentinel;});},
 ai:{update(dt){event('ai:'+bits(dt));},castSkillWhenControlled(){throw Error('unexpected controlled AI');}},
 recheckManualCast(){event('manual');once(13,()=>{u.mp=47;event('mutate:manual-throw');throw sentinel;});},
 getTransferMpTarget(){event('mp-target');return resourceMethods[3].call(u);},setMp(value,owner){assert.equal(owner,u);event('mp:'+bits(value));return resourceMethods[0].call(u,value,owner);},
 getTransferTarget(){event('hp-target');return resourceMethods[2].call(u);},setHp(value){event('hp:'+bits(value));return resourceMethods[1].call(u,value);},
 battledata:{addRestore(value){event('restore:'+bits(value));}},getUnitScale(){event('scale');return 1;}};
 skill.caster=u;state={unit:u,skill,events,sounds,infos,freeze:1,active:[],queues:[]};state.queues.push(state.active);
 return{state,event,snapshot,unitUpdate,skillUpdate,context,sentinel,get frames(){return frames;},get used(){return used;}};
}
export const sourcePins={unit:unitPin,skill:skillDefinition,resources:resourcesPin};
export const oracleProfile=profile;
export function oracle(c){createFixture(c);const u=state.unit;
 const errors=[];
 for(let frame=0;frame<2;frame++){
  state.frame=frame;event('frame:'+frame+':enter');try{unitUpdate.call(u,c.dt);}catch(e){if(e!==sentinel)throw e;errors.push('unit:'+frame);event('error:unit');}event('frame:'+frame+':after-unit');
  const queue=state.active;try{while(queue.length)queue.shift()();}catch(e){if(e!==sentinel)throw e;errors.push('drain:'+frame);event('error:drain');}event('frame:'+frame+':after-drain');
 }
 return{frames,errors,used};
}
function firstDifference(a,b,path='$'){if(Object.is(a,b))return null;if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return{path,expected:a,actual:b};const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length||ak.some((k,i)=>k!==bk[i]))return{path:path+'.keys',expected:ak,actual:bk};for(const k of ak){const d=firstDifference(a[k],b[k],path+'.'+k);if(d)return d;}return null;}
async function main(){
// Build the pinned Buck target after taking the source snapshot; an optional
// supplied binary must equal that freshly built artifact, not merely be old code.
const suppliedBinary=process.argv[2]&&!process.argv[2].startsWith('--')?resolve(process.argv[2]):null;
const at=process.argv.indexOf('--cases'),count=at<0?20000:Number(process.argv[at+1]);assert.ok(Number.isSafeInteger(count)&&count>=108);
const dtValues=[0,-0,.125,.1,-.125,.03125];
const cases=Array.from({length:count},(_,i)=>({action:i%18,dt:dtValues[Math.floor(i/18)%dtValues.length],mspd:(i%301)-150,atkhast:(i%171)-85,hast:(i%101)-50,mpr:(i%13)/8,hpr:(i%7)-3,mp:10+(i%29),global:(i%11)/4,unfreeze:(i%3-1)/16}));
const serialize=c=>[c.action,...[c.dt,c.mspd,c.atkhast,c.hast,c.mpr,c.hpr,c.mp,c.global,c.unfreeze].map(bits)].join(' '),inputText=cases.map(serialize).join('\n')+'\n';
const work=resolve(root,'work/unit-skill-runtime');await mkdir(work,{recursive:true});
async function rustFiles(directory){const files=[];for(const row of await readdir(resolve(root,directory),{withFileTypes:true})){const name=directory+'/'+row.name;if(row.isDirectory())files.push(...await rustFiles(name));else if(name.endsWith('.rs'))files.push(name);}return files;}
const sourceFiles=[...await rustFiles('crates/battle-core/src'),'crates/battle-core/examples/unit_skill_runtime_check.rs','tools/check-unit-skill-runtime.mjs','tools/rng-trace.mjs','config/unit-translation.json','config/skill-translation.json','config/unit-resources-translation.json','config/source-oracle-runtime.json',unitPin.source,'Cargo.toml','Cargo.lock','crates/battle-core/Cargo.toml','crates/battle-core/BUCK','toolchains/BUCK','.buckconfig','rust-toolchain.toml','config/toolchains.json'];
const sources={};for(const file of sourceFiles)sources[file]=sha(await readFile(resolve(root,file)));
const toolchain=JSON.parse(await readFile(resolve(root,'config/toolchains.json'))),buck=resolve(root,'work/buck2'),rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),rustc=resolve(rustBin,'rustc');
assert.equal(sha(await readFile(buck)),toolchain.buck2LinuxX86_64Sha256,'Unpinned Buck2');
const compilerSha256=sha(await readFile(rustc)),rustVersion=spawnSync(rustc,['--version'],{cwd:root,encoding:'utf8'});assert.equal(rustVersion.status,0);assert.ok(rustVersion.stdout.startsWith('rustc '+toolchain.rust+' '),'Unpinned Rust');
const buildArgs=['build','root//crates/battle-core:unit_skill_runtime_check','--show-full-output'],build=spawnSync(buck,buildArgs,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH},encoding:'utf8',maxBuffer:16*1024*1024});
await writeFile(resolve(work,'build.stdout'),build.stdout??'');await writeFile(resolve(work,'build.stderr'),build.stderr??'');assert.equal(build.status,0,build.stderr);
const outputs=build.stdout.trim().split('\n').filter(line=>line.startsWith('root//crates/battle-core:unit_skill_runtime_check '));assert.equal(outputs.length,1,'Unique Buck output required');const binary=resolve(root,outputs[0].slice('root//crates/battle-core:unit_skill_runtime_check '.length).trim()),binarySha256=sha(await readFile(binary));
if(suppliedBinary)assert.equal(sha(await readFile(suppliedBinary)),binarySha256,'Supplied binary differs from fresh pinned Buck artifact');
await writeFile(resolve(work,'input'),inputText);
const out=openSync(resolve(work,'actual'),'w'),err=openSync(resolve(work,'stderr'),'w'),inFile=openSync(resolve(work,'input'),'r');let result;try{result=await new Promise((accept,reject)=>{const child=spawn(binary,[],{cwd:root,stdio:[inFile,out,err]});child.on('error',reject);child.on('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(inFile);closeSync(out);closeSync(err);}assert.equal(result.code,0,await readFile(resolve(work,'stderr'),'utf8'));
const expectedFile=openSync(resolve(work,'expected'),'w');let index=0,eventCount=0;const actionCoverage=Array.from({length:18},(_,action)=>({action,cases:0,mutationExecuted:0}));try{for await(const line of createInterface({input:createReadStream(resolve(work,'actual')),crlfDelay:Infinity})){assert.ok(index<cases.length,'Extra output');const expected=oracle(cases[index]),actual=JSON.parse(line),difference=firstDifference(expected,actual);if(difference){await writeFile(resolve(root,'benchmarks/validation/unit-skill-runtime-first-divergence.json'),JSON.stringify({passed:false,index,input:serialize(cases[index]),difference,expected,actual},null,2)+'\n');throw Error('Combined Unit/Skill runtime diverged: '+JSON.stringify({index,difference}));}writeSync(expectedFile,JSON.stringify(expected)+'\n');eventCount+=expected.frames.length;actionCoverage[cases[index].action].cases++;if(expected.used)actionCoverage[cases[index].action].mutationExecuted++;index++;}}finally{closeSync(expectedFile);}assert.equal(index,cases.length,'Missing output');
const artifacts=[];for(const name of ['input','actual','expected']){const file='benchmarks/validation/unit-skill-runtime.'+name+'.gz';await pipeline(createReadStream(resolve(work,name)),createGzip({level:9}),createWriteStream(resolve(root,file)));artifacts.push({file,sha256:sha(await readFile(resolve(root,file)))});}
for(const [file,expected]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Build/run source changed: '+file);assert.equal(sha(await readFile(binary)),binarySha256,'Binary changed during gate');assert.equal(sha(await readFile(rustc)),compilerSha256,'Compiler changed during gate');
const report={version:1,passed:true,cases:count,framesPerCase:2,eventCount,actionCoverage,sourcesUnchangedThroughoutBuildAndRun:true,source:{unit:unitPin,skill:skillDefinition,resources:resourcesPin},sources,build:{tool:buck,toolSha256:toolchain.buck2LinuxX86_64Sha256,args:buildArgs,rustc,compilerSha256,rustVersion:rustVersion.stdout.trim(),exitCode:build.status,stdoutSha256:sha(build.stdout),stderrSha256:sha(build.stderr)},binary:{path:binary,sha256:binarySha256},oracleProfile:profile,artifacts,scope:'Original source Unit.update invokes original source Skill.update, and original base setMp/setHp/transfer selectors, then original queued callbacks execute across two frames. Rust uses the connected unit/skill runtime with required explicit fixture mechanics. Every recorded callback boundary state and selected field f64 bit is compared, including shared-unit mutation, info replacement, queue replacement and errors after writes. This is a component-chain fixture gate, not complete battle or whole-program equivalence.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/unit-skill-runtime.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:count,eventCount}));

}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))await main();
