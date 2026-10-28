import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createReadStream,createWriteStream,openSync,closeSync,writeSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {runInContext} from 'node:vm';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {bits} from './rng-trace.mjs';
import {createFixture,sourcePins,oracleProfile} from './check-unit-skill-runtime.mjs';
import {loadTickSource} from './check-scheduler.mjs';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const at=process.argv.indexOf('--cases'),count=at<0?20000:Number(process.argv[at+1]);assert.ok(Number.isSafeInteger(count)&&count>=132);
const {source:tickSource,metadata:tickPin}=await loadTickSource();
const inputs=['crates/battle-core/BUCK','toolchains/BUCK','.buckconfig','rust-toolchain.toml','config/toolchains.json','Cargo.toml','Cargo.lock','crates/battle-core/Cargo.toml','crates/battle-core/examples/unit_skill_runtime_check.rs','crates/battle-core/examples/engine_unit_runtime_check.rs','tools/check-engine-unit-runtime.mjs','tools/check-unit-skill-runtime.mjs','tools/check-scheduler.mjs','tools/rng-trace.mjs','config/source-oracle-runtime.json','config/unit-translation.json','config/skill-translation.json','config/unit-resources-translation.json','config/scheduler-translation.json',tickPin.source];
for(const name of await readdir(resolve(root,'crates/battle-core/src')))if(name.endsWith('.rs'))inputs.push('crates/battle-core/src/'+name);
const sources={};for(const file of inputs)sources[file]=sha(await readFile(resolve(root,file)));
const toolchain=JSON.parse(await readFile(resolve(root,'config/toolchains.json'))),buck=resolve(root,'work/buck2'),rustBin=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin'),rustc=resolve(rustBin,'rustc');
assert.equal(sha(await readFile(buck)),toolchain.buck2LinuxX86_64Sha256,'Unpinned Buck2');
const compilerSha256=sha(await readFile(rustc)),rustVersion=spawnSync(rustc,['--version'],{cwd:root,encoding:'utf8'});assert.equal(rustVersion.status,0);assert.ok(rustVersion.stdout.startsWith('rustc '+toolchain.rust+' '),'Unpinned Rust');
const target='root//crates/battle-core:engine_unit_runtime_check',buildArgs=['build',target,'--show-full-output'],build=spawnSync(buck,buildArgs,{cwd:root,env:{...process.env,PATH:rustBin+':'+process.env.PATH},encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(build.status,0,build.stderr);
for(const [file,expected]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Changed during build: '+file);
const outputs=build.stdout.trim().split('\n').filter(line=>line.startsWith(target+' '));assert.equal(outputs.length,1,'Unique Buck output required');const binary=resolve(root,outputs[0].slice((target+' ').length).trim()),binarySha256=sha(await readFile(binary));
let tick;
function engineOracle(c){
 const fixture=createFixture(c),{state,event,context,unitUpdate,sentinel}=fixture,u=state.unit;
 const lists=[[u]],engine={running:true,freeze_level:1,ignore_level:0,time_limit:90,time_skill_add:0,special_time_limit:0,tick_interval:c.dt,ticks:0,willRestartGame:false,mode:'stage',config:{mode:'stage',localBot:false},alive_enemy_count:1,alive_player_count:1,enemy_hero_dead_count:0,player_hero_dead_count:0,enity_list_name:['unit_list'],getMode(){return this.mode;},getTimeRemain(){return this.time_limit+this.time_skill_add;}};
 let group=lists[0];Object.defineProperty(engine,'unit_list',{get:()=>group,set:value=>{if(!lists.includes(value))lists.push(value);group=value;}});
 Object.defineProperty(state,'freeze',{configurable:true,get:()=>engine.freeze_level,set:value=>engine.freeze_level=value});
 const label=()=>[bits(engine.time_limit),bits(engine.ticks),engine.mode,engine.config.mode??'none',lists.indexOf(group),lists.map(list=>list.map(e=>e===u?0:'invalid').join(',')).join('/'),String(Number(u.frozen_model))+String(Number(u.terminated))].join(':');
 const engineEvent=name=>event(name+':'+label());
 const previous=context.ed.battleEngine;engine.getStageRect=previous.getStageRect;engine.unfreeze=previous.unfreeze;context.ed.battleEngine=engine;
 engine.weatherUpdate=dt=>engineEvent('engine:weather:'+bits(dt));engine.tickOperation=()=>engineEvent('engine:operation');engine.tickRageObjects=dt=>engineEvent('engine:rage:'+bits(dt));engine.checkVictoryTimeFixInRaceDream=()=>engineEvent('engine:race-fix');engine.checkPush=dt=>engineEvent('engine:push:'+bits(dt));engine.toBtLogString=()=>{engineEvent('engine:format');return'tick';};engine.onBattleEnd=outcome=>{assert.equal(outcome,'timeout');engineEvent('engine:timeout');engine.running=false;};
 context.ed.halloweenFunBattleMgr={isHalloweenFunMode:()=>{engineEvent('engine:is-halloween');return false;}};context.ed.BattleEngine={modesUsingMaxTicks:{indexOf:()=>{engineEvent('engine:uses-max');return-1;}}};context.ed.btLog.append=text=>{assert.equal(text,'tick');engineEvent('engine:append');};
 u.terminated=false;u.update=function(dt){engineEvent('engine:update:'+bits(dt));unitUpdate.call(this,dt);};
 let extraUsed=false;const originalAttack=state.skill.onAttackFrame;state.skill.onAttackFrame=function(){originalAttack.call(this);if(extraUsed)return;switch(c.action){case 18:extraUsed=true;u.frozen_model=true;event('mutate:engine-unit-frozen');break;case 19:extraUsed=true;engine.mode='race_dream';event('mutate:engine-mode');break;case 20:extraUsed=true;engine.tick_interval=.25;event('mutate:engine-interval');break;}};
 const originalManual=u.recheckManualCast;u.recheckManualCast=function(){originalManual.call(this);if(c.action===21&&!extraUsed){extraUsed=true;engine.freeze_level=0;event('mutate:engine-freeze-throw');throw sentinel;}};
 tick??=runInContext('('+tickSource+')',context);const errors=[];
 for(let frame=0;frame<2;frame++){
  state.frame=engine.ticks;event('frame:'+frame+':enter');try{tick.call(engine);}catch(e){if(e!==sentinel)throw e;errors.push('unit:'+frame);event('error:unit');}event('frame:'+frame+':after-unit');
  const queue=state.active;try{while(queue.length)queue.shift()();}catch(e){if(e!==sentinel)throw e;errors.push('drain:'+frame);event('error:drain');}event('frame:'+frame+':after-drain');
 }
 return{frames:fixture.frames,errors,used:fixture.used||extraUsed};
}
function firstDifference(a,b,path='$'){if(Object.is(a,b))return null;if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return{path,expected:a,actual:b};const ak=Object.keys(a),bk=Object.keys(b);if(ak.length!==bk.length||ak.some((k,i)=>k!==bk[i]))return{path:path+'.keys',expected:ak,actual:bk};for(const k of ak){const d=firstDifference(a[k],b[k],path+'.'+k);if(d)return d;}return null;}
const dtValues=[0,-0,.125,.1,-.125,.03125],cases=Array.from({length:count},(_,i)=>({action:i%22,dt:dtValues[Math.floor(i/22)%dtValues.length],mspd:(i%301)-150,atkhast:(i%171)-85,hast:(i%101)-50,mpr:(i%13)/8,hpr:(i%7)-3,mp:10+(i%29),global:(i%11)/4,unfreeze:(i%3-1)/16}));
const serialize=c=>[c.action,...[c.dt,c.mspd,c.atkhast,c.hast,c.mpr,c.hpr,c.mp,c.global,c.unfreeze].map(bits)].join(' '),work=resolve(root,'work/engine-unit-runtime');await mkdir(work,{recursive:true});await writeFile(resolve(work,'input'),cases.map(serialize).join('\n')+'\n');
const input=openSync(resolve(work,'input'),'r'),out=openSync(resolve(work,'actual'),'w'),err=openSync(resolve(work,'stderr'),'w');let result;try{result=await new Promise((accept,reject)=>{const child=spawn(binary,[],{cwd:root,stdio:[input,out,err]});child.on('error',reject);child.on('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(input);closeSync(out);closeSync(err);}assert.equal(result.code,0,await readFile(resolve(work,'stderr'),'utf8'));
const expectedFile=openSync(resolve(work,'expected'),'w');let index=0,eventCount=0;try{for await(const line of createInterface({input:createReadStream(resolve(work,'actual')),crlfDelay:Infinity})){assert.ok(index<cases.length,'Extra output');const expected=engineOracle(cases[index]),actual=JSON.parse(line),difference=firstDifference(expected,actual);if(difference){await writeFile(resolve(root,'benchmarks/validation/engine-unit-runtime-first-divergence.json'),JSON.stringify({passed:false,index,input:serialize(cases[index]),difference,expected,actual},null,2)+'\n');throw Error('Engine runtime diverged: '+JSON.stringify({index,difference}));}writeSync(expectedFile,JSON.stringify(expected)+'\n');eventCount+=expected.frames.length;index++;}}finally{closeSync(expectedFile);}assert.equal(index,cases.length,'Missing output');
for(const [file,expected]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Changed during execution: '+file);assert.equal(sha(await readFile(binary)),binarySha256,'Binary changed during execution');assert.equal(sha(await readFile(rustc)),compilerSha256,'Compiler changed during execution');
const artifacts=[];for(const name of ['input','actual','expected']){const file='benchmarks/validation/engine-unit-runtime.'+name+'.gz';await pipeline(createReadStream(resolve(work,name)),createGzip({level:9}),createWriteStream(resolve(root,file)));artifacts.push({file,sha256:sha(await readFile(resolve(root,file)))});}
const report={version:1,passed:true,cases:count,framesPerCase:2,eventCount,source:{engine:tickPin,...sourcePins},sources,unchangedAcrossBuildAndExecution:true,build:{tool:buck,toolSha256:toolchain.buck2LinuxX86_64Sha256,rustc,compilerSha256,rustVersion:rustVersion.stdout.trim(),args:buildArgs,exitCode:build.status,stdoutSha256:sha(build.stdout),stderrSha256:sha(build.stderr)},binary:{path:binary,sha256:binarySha256},oracleProfile,artifacts,scope:'Original source BattleEngine.tick -> Unit.update -> Skill.update -> base resource controllers -> deferred callbacks across two frames against the connected Rust driver. Required explicit fixture mechanics, selected states and raw f64 bits, shared engine mode/freeze/frozen-model writes and source error prefixes. This is not a complete game backend, full-scene qualification, or a battle throughput benchmark.',qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/engine-unit-runtime.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:count,eventCount}));
