import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const p=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''}});process.stdout.write(p.stdout??'');process.stderr.write(p.stderr??'');process.exit(p.status??1);}
const metadataFile='config/unit-resources-translation.json',metadataBytes=await readFile(resolve(root,metadataFile)),metadata=JSON.parse(metadataBytes),source=await readFile(resolve(root,metadata.source),'utf8');
const bodies=metadata.functions.map(f=>{const s=source.slice(f.start,f.end);assert.equal(sha(s),f.sha256);assert.equal(s,f.source);return s;});
const files=['crates/battle-core/src/unit_resources.rs','crates/battle-core/src/unit.rs','crates/battle-core/src/skill.rs','crates/battle-core/src/entity.rs','crates/battle-core/src/js_math.rs','crates/battle-core/src/unit_speeder.rs','tools/check-unit-resources.rs','tools/check-unit-resources.mjs','config/source-oracle-runtime.json',metadataFile],sources={};for(const f of files)sources[f]=sha(await readFile(resolve(root,f)));
const buffer=new ArrayBuffer(8),view=new DataView(buffer);function bits(x){view.setFloat64(0,x,false);return view.getBigUint64(0,false).toString(16).padStart(16,'0');}function number(x){view.setBigUint64(0,BigInt('0x'+x),false);return view.getFloat64(0,false);}
const realm=createContext(constants.DONT_CONTEXTIFY);let active;realm.ed={btLog:{setMP:()=>active.log('log-mp'),setHp:()=>active.log('log-hp')},battleEngine:{}};
Object.defineProperty(realm.ed.battleEngine,'ticks',{get(){active.event('ticks');if(active.c.flags&128)active.u.hp=13;return active.n[5]}});
const funcs=bodies.map(s=>runInContext('('+s+')',realm));
function oracle(c){const n=c.n.map(number),u={hp:n[1],mp:n[2]},other={id:1};u.id=0;let last=n[4],reads=0,targetReads=0;const events=[],sentinel={sentinel:true};
 const ctx={u,n,c,event(k){events.push(k+'|'+bits(u.hp)+':'+bits(u.mp)+':'+bits(last));if(events.length===c.fail)throw sentinel;},log(k){this.event(k);if(c.flags&16){u.hp=66;u.mp=77;}}};active=ctx;
 const maximum=k=>{reads++;ctx.event(k+':'+reads);if(c.flags&2)u.mp=5;if(c.flags&4)u.hp=-9;return c.flags&8&&reads>1?n[6]:n[3]};
 const target=k=>{targetReads++;ctx.event(k+':'+targetReads);return [null,other,undefined,u][targetReads>1?c.tb:c.ta]};
 u.info={};Object.defineProperty(u.info,'MP',{get:()=>maximum('max-mp')});u.attribs={};Object.defineProperty(u.attribs,'HP',{get:()=>maximum('max-hp')});
 Object.defineProperty(u,'lastHpChangeTick',{get:()=>last,set(v){ctx.event('last:'+bits(v));last=v;if(c.flags&512)u.hp=14;}});
 u.buff_effects={};Object.defineProperty(u.buff_effects,'noAddMp',{get(){ctx.event('no-add');if(c.flags&256)u.mp=42;return !!(c.flags&1)}});
 Object.defineProperty(u.buff_effects,'transferHeal',{get(){ctx.event('enable-heal');return !!(c.flags&32)}});Object.defineProperty(u.buff_effects,'transferMp',{get(){ctx.event('enable-mp');return !!(c.flags&32)}});
 u.buffEffectsRelated={};Object.defineProperty(u.buffEffectsRelated,'transferHeal',{get:()=>target('target-heal')});Object.defineProperty(u.buffEffectsRelated,'transferMp',{get:()=>target('target-mp')});
 let value=null,error=null;try{const v=funcs[c.op].call(u,n[0],u);value=v===null?'null':v===undefined?'undefined':'value:'+v.id;}catch(e){if(e!==sentinel)throw e;error='sentinel';}
 return{events,state:[bits(u.hp),bits(u.mp),bits(last)],value,error};}
let seed=0x8930b7e1;const next=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n;};
const values=[0,-0,1,-1,100,-100,.125,.1,1000,Infinity,-Infinity,number('7ff8000000000000'),number('fff8000000000000'),number('7ff8000000001234')].map(bits);
const cases=Array.from({length:20000},()=>({op:next(4),flags:next(1024),fail:next(7),ta:next(4),tb:next(4),n:Array.from({length:7},()=>values[next(values.length)])}));
const directed=[
 {label:'mp-clamp-rereads-changing-maximum',op:0,flags:8,n:[200,50,10,100,4,9,-12]},
 {label:'no-add-getter-only-on-increase',op:0,flags:257,n:[20,50,10,100,4,9,100]},
 {label:'hp-signed-zero-does-not-change-tick',op:1,flags:0,n:[-0,0,10,100,4,9,100]},
 {label:'hp-nan-updates-tick',op:1,flags:0,n:[NaN,NaN,10,100,4,9,100]},
 {label:'hp-log-throw-keeps-hp-and-tick',op:1,flags:0,fail:4,n:[20,50,10,100,4,9,100]},
 {label:'transfer-second-read-null',op:2,flags:32,ta:1,tb:0},
 {label:'transfer-second-read-undefined',op:3,flags:32,ta:1,tb:2},
 {label:'transfer-disabled-does-not-read-related',op:3,flags:0,ta:1,tb:1},
];for(const c of directed)cases.push({fail:0,ta:1,tb:1,n:[1,50,10,100,4,9,100],...c,n:(c.n??[1,50,10,100,4,9,100]).map(bits)});
await mkdir(resolve(root,'work/unit-resources'),{recursive:true});
const rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc'),binary=resolve(root,'work/unit-resources/check'),compileArgs=['--edition=2024','-O','-A','dead_code','tools/check-unit-resources.rs','-o',binary],compiled=spawnSync(rustc,compileArgs,{cwd:root,encoding:'utf8'});assert.equal(compiled.status,0,compiled.stderr);
const input=cases.map(c=>[c.op,c.flags,c.fail,c.ta,c.tb,...c.n].join(' ')).join('\n')+'\n';const run=spawnSync(binary,[],{cwd:root,input,encoding:'utf8',maxBuffer:64*1024*1024});assert.equal(run.status,0,run.stderr);const actual=run.stdout.trim().split('\n').map(line=>JSON.parse(line));assert.equal(actual.length,cases.length);
const outputs=[];let events=0;for(let i=0;i<cases.length;i++){const expected=oracle(cases[i]);if(JSON.stringify(expected)!==JSON.stringify(actual[i])){const failure={passed:false,index:i,input:cases[i],expected,actual:actual[i]};await writeFile(resolve(root,'benchmarks/validation/unit-resources-failure.json'),JSON.stringify(failure,null,2)+'\n');throw Error('Resource differential first difference case '+i);}events+=expected.events.length;outputs.push({input:cases[i],expected,actual:actual[i]});}
const archive='benchmarks/validation/unit-resources.outputs.json.gz',bytes=Buffer.from(JSON.stringify(outputs));await writeFile(resolve(root,archive),gzipSync(bytes,{level:9}));
for(const [f,expected] of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,f))),expected,'Source changed during gate: '+f);assert.equal(sha(await readFile(resolve(root,metadata.source))),sha(source),'Original source changed during gate');
const report={version:1,passed:true,scope:'Base resource controllers against the canonical Rust unit::World hp/mp arena, with source-pinned metadata getters/log hooks. This is a component fixture gate, not whole-battle qualification or measured simulation throughput.',cases:cases.length,generatedCases:20000,directedCases:directed.map(c=>c.label),events,sourcesUnchangedThroughoutRun:true,rawF64BitsMatched:true,sourceFunctions:metadata.functions.map(({source,...f})=>f),sourceFile:metadata.source,sourceFileSha256:sha(source),sources,oracleProfile:profile,compiler:{path:rustc,sha256:sha(await readFile(rustc)),args:compileArgs},binarySha256:sha(await readFile(binary)),inputSha256:sha(input),archive:{file:archive,sha256:sha(await readFile(resolve(root,archive))),uncompressedSha256:sha(bytes)},integration:{canonicalUnitArena:true,additionalUnitRegistry:false,virtualOverrideDispatch:'Required at caller; these are base method implementations.',requiredHooks:'All metadata/getter/log hooks are mandatory and errors preserve already-performed mutations.',nativeBattleIntegrated:false},qualifiesFor10000Target:false};await writeFile(resolve(root,'benchmarks/validation/unit-resources.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:cases.length,events,sourceFunctions:report.sourceFunctions.map(f=>f.name)}));
