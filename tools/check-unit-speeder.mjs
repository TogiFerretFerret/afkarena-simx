import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {bits,fromBits} from './rng-trace.mjs';
const root=resolve(import.meta.dirname,'..'),runner=process.argv[2];
assert.ok(runner,'Usage: NODE_OPTIONS=\'\' node --jitless tools/check-unit-speeder.mjs RUNNER');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags);assert.equal(process.env.NODE_OPTIONS??'','');
const audit=JSON.parse(await readFile(resolve(root,'benchmarks/validation/native-unit-controller.json'),'utf8'));
const original=await readFile(resolve(root,audit.source.source),'utf8'),block=original.slice(audit.firstBlock.start,audit.firstBlock.end),sha=text=>createHash('sha256').update(text).digest('hex');
assert.equal(sha(block),audit.firstBlock.sha256);assert.equal(sha(original.slice(audit.source.start,audit.source.end)),audit.source.sha256);
const context=createContext({}),oracle=runInContext('(function(e){'+block+'return {raw_dt:r,speeder:this.speeder,dt_action:this.dt_action,n:n};})',context);
const directed=['0000000000000000','8000000000000000','0000000000000001','8000000000000001','3fc0000000000000','bff0000000000000','4059000000000000','c052c00000000000','7fefffffffffffff','ffefffffffffffff','7ff0000000000000','fff0000000000000','7ff8000000000017','fff8000000000018','7ff0000000000021','fff0000000000022'];
let state=0x74c123ab;function next(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
function word(){return next().toString(16).padStart(8,'0')+next().toString(16).padStart(8,'0');}
const cases=[];
for(let field=0;field<4;field++)for(const value of directed)for(let flags=0;flags<128;flags++){const raw=['4059000000000000','4024000000000000','3fc0000000000000','bff0000000000000'];raw[field]=value;cases.push({raw,flags});}
// Include the finite-input overflow*zero case explicitly: admission must reject
// even though each original input passed the finite-number test.
cases.push({raw:['7fefffffffffffff','7fefffffffffffff','0000000000000000','bff0000000000000'],flags:2|4|64});
while(cases.length<20000)cases.push({raw:[word(),word(),word(),word()],flags:next()%128});
const lines=cases.map(c=>c.raw.join(' ')+' '+c.flags),run=spawnSync(resolve(runner),[],{input:lines.join('\n')+'\n',encoding:'utf8',maxBuffer:8*1024*1024});
assert.ifError(run.error);assert.equal(run.status,0,run.stderr);
const actual=run.stdout.trim().split('\n');assert.equal(actual.length,cases.length);
let admitted=0,rejected=0,outputs=0;
for(let index=0;index<cases.length;index++){
 const{raw,flags}=cases[index],mspd=fromBits(raw[0]),atkhast=fromBits(raw[1]),dt=fromBits(raw[2]),set=fromBits(raw[3]);
 const skill=flags&2?{info:{SetSpeeder:flags&64?set:null},lockActionSpeeder:!!(flags&8)}:null;
 const unit={attribs:{MSPD:mspd,ATKHAST:atkhast},config:{is_boss:!!(flags&1)},current_skill:skill,basic_skill:flags&4?skill:{},buff_effects:{frozen:!!(flags&16),motionless:!!(flags&32)},speeder:99,dt_action:99};
 const result=oracle.call(unit,dt),guard=[mspd,atkhast,dt].every(Number.isFinite)&&(!(flags&2&&flags&64)||Number.isFinite(set))&&!Number.isNaN(result.speeder)&&!Number.isNaN(result.dt_action);
 const expected=[bits(result.raw_dt),bits(result.speeder),bits(result.dt_action),String(Number(guard))].join(' ');
 try{assert.equal(actual[index],expected);assert.equal(bits(result.n),bits(result.dt_action));}catch(error){await mkdir(resolve(root,'work'),{recursive:true});await writeFile(resolve(root,'work/unit-speeder-divergence.json'),JSON.stringify({index,input:lines[index],expected,actual:actual[index]},null,2)+'\n');throw error;}
 if(guard)admitted++;else rejected++;outputs+=3;
}
const report={version:1,kind:'source-unit-speeder-block-differential',source:{file:audit.source.source,start:audit.firstBlock.start,end:audit.firstBlock.end,sha256:sha(block)},cases:cases.length,directedCases:4*directed.length*128+1,rawBitOutputs:outputs,admitted,rejected,rawBitsExact:true,corpusSha256:sha(lines.join('\n')+'\n'),runnerSha256:sha(await readFile(resolve(runner))),rustSha256:sha(await readFile(resolve(root,'crates/battle-core/src/unit_speeder.rs'))),arithmeticSha256:sha(await readFile(resolve(root,'crates/battle-core/src/js_math.rs'))),runnerSourceSha256:sha(await readFile(resolve(root,'tools/check-unit-speeder.rs'))),referenceRuntime:{node:process.version,v8:process.versions.v8,flags:process.execArgv,NODE_OPTIONS:process.env.NODE_OPTIONS??''},reusedBy:'Existing typed Rust World.update_unit',integratedWithCanonicalVm:false,qualifiesFor10000Target:false,limitations:['Tests the exact original callback-free block, output Number bits and conservative arithmetic admission only.','Does not establish canonical VM slot guards, interior continuation splice, source write descriptors, complete battles or battle throughput.','No NaN payload normalization; guarded path rejects before any future VM output write.']};
await mkdir(resolve(root,'work'),{recursive:true});await rm(resolve(root,'work/unit-speeder-divergence.json'),{force:true});await writeFile(resolve(root,'benchmarks/validation/unit-speeder.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
