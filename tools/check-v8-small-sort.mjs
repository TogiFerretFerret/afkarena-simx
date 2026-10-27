import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {binary64} from './battle-trace.mjs';
const root=resolve(import.meta.dirname,'..'),sha=x=>createHash('sha256').update(x).digest('hex');
const policy=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,policy.node);assert.equal(process.versions.v8,policy.v8);assert.deepEqual(process.execArgv,policy.rawBitReferenceFlags);assert.equal(process.env.NODE_OPTIONS??'','');
const vendor='tools/vendor/v8-sort-13.6.233.17/array-sort.tq',source=await readFile(resolve(root,vendor));
assert.equal(sha(source),'2ac3d8fc187e4f5096afb153d018390e2b250cde3e36badafe89da3faeebe55e');
const battle=await readFile(resolve(root,'src/srcmodule/game_battle.js'),'utf8');
const salaSource='function(e,t){var a=-1!==m.morphingList.indexOf(e)?1e3:0,i=-1!==m.morphingList.indexOf(t)?1e3:0;return e.config.is_summoned&&(a+=100),t.config.is_summoned&&(i+=100),e.buff_effects.uncontrollable&&(a+=10),t.buff_effects.uncontrollable&&(i+=10),(a+=e.battledata.getDamage()-t.battledata.getDamage()<0?1:-1)-i}';
assert.ok(battle.includes(salaSource));
const inputs=['tools/check-v8-small-sort.mjs','tools/check-v8-small-sort.rs','crates/battle-core/src/v8_small_sort.rs','config/source-oracle-runtime.json','src/srcmodule/game_battle.js',vendor];
const hashInputs=async()=>Object.fromEntries(await Promise.all(inputs.map(async p=>[p,sha(await readFile(resolve(root,p)))])));
const inputHashes=await hashInputs();
const rustc=process.env.RUSTC??resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc'),binary=resolve(root,'work/check-v8-small-sort');
const compile=spawnSync(rustc,['--edition=2024','-O',resolve(root,'tools/check-v8-small-sort.rs'),'-o',binary],{encoding:'utf8'});assert.equal(compile.status,0,compile.stderr);
let state=0xd00df00d;function draw(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state;}
const cases=[],expected=[],modeCounts={},lengthCounts={},shapeCounts={};let comparisonCount=0,throwingCases=0,duplicateTokenCases=0;
for(let id=0;id<20000;id++){
 const n=id<128?id%64:draw()%64,mode=id%12,seed=draw(),throwAt=id%7===0?1+draw()%Math.max(1,n*3):0,shape=id%8;
 const values=Array.from({length:n},(_,i)=>{const d=draw();switch(shape){case 0:return d%7;case 1:return i;case 2:return n-i;case 3:return 0;case 4:return i%3===0?NaN:i%3===1?Infinity:-Infinity;case 5:return i%2?-0:0;case 6:return Math.floor(i/8)%2?-i:i;default:return(d-2147483648)/1024;}});
 let rng=seed,calls=[];const units=values.map((value,index)=>({id:index,config:{is_summoned:index%5===0},buff_effects:{uncontrollable:index%7===0},battledata:{getDamage:()=>value}}));
 const sala=new Function('m','return '+salaSource)({morphingList:units.filter(u=>u.id%4===0)});
 const compare=(a,b)=>{calls.push([a,b]);if(calls.length===throwAt)throw new Error('throw:'+throwAt);const x=values[a],y=values[b];switch(mode){
 case 0:return x-y;case 1:return y-x;case 2:return-1;case 3:return 1;case 4:return 0;case 5:return NaN;case 6:return sala(units[a],units[b]);
 case 7:rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;rng>>>=0;return 0.5-rng/4294967296;
 case 8:return a%3===b%3?0:(a%3+1)%3===b%3?-1:1;
 case 9:return calls.length%2===0?-1:1;case 10:return x<y?-Infinity:Infinity;case 11:return calls.length%3===0?NaN:x-y;}};
 const tokenMod=id%5===0?Math.ceil(n/2):0;if(tokenMod&&tokenMod<n)duplicateTokenCases++;
 const array=Array.from({length:n},(_,i)=>tokenMod?i%tokenMod:i);let status='ok';try{array.sort(compare);}catch(error){status=error.message;throwingCases++;}
 expected.push({status,output:array,calls,rng});comparisonCount+=calls.length;
 cases.push([mode,seed,throwAt,tokenMod,...values.map(binary64)].join(' '));modeCounts[mode]=(modeCounts[mode]??0)+1;lengthCounts[n]=(lengthCounts[n]??0)+1;shapeCounts[shape]=(shapeCounts[shape]??0)+1;
}
const run=spawnSync(binary,[],{input:cases.join('\n')+'\n',encoding:'utf8',maxBuffer:128*1024*1024});assert.equal(run.status,0,run.stderr);
const output=run.stdout.trim().split('\n').map(JSON.parse);assert.equal(output.length,expected.length);
for(let i=0;i<expected.length;i++)assert.deepEqual(output[i],expected[i],`case ${i} input ${cases[i]}`);
const rejected=spawnSync(binary,[],{input:'0 123 0 0 '+Array(64).fill(binary64(1)).join(' ')+'\n',encoding:'utf8'});assert.equal(rejected.status,0,rejected.stderr);const boundary=JSON.parse(rejected.stdout);assert.equal(boundary.status,'unsupported:64');assert.deepEqual(boundary.calls,[]);
assert.deepEqual(await hashInputs(),inputHashes,'Sort proof inputs changed');
const report={version:1,qualifiesFor10000Target:false,reference:policy,inputHashes,source:{url:'https://raw.githubusercontent.com/v8/v8/13.6.233.17/third_party/v8/builtins/array-sort.tq',sha256:sha(source),functions:['CountAndMakeRun','BinaryInsertionSort','ComputeMinRunLength','ArrayTimSortImpl','SortCompareUserFn'],scope:'0..63 dense non-undefined work elements; ComputeMinRunLength(n)==n; no merge/gallop calls occur'},cases:cases.length,orderedComparatorCalls:comparisonCount,throwingCases,duplicateTokenCases,modeCounts,lengthCounts,shapeCounts,salaComparator:salaSource,result:'PASS: every final token sequence, ordered comparator argument pair, comparator exception position and final RNG state matches the pinned source',unsupportedLength64:{rejectedBeforeComparator:true},compiler:{path:rustc,version:spawnSync(rustc,['--version'],{encoding:'utf8'}).stdout.trim(),optimization:'-O'},canonicalResultAndCallTraceSha256:sha(JSON.stringify(output)),candidateOutputSha256:sha(run.stdout),referenceOutputSha256:sha(expected.map(x=>JSON.stringify(x)).join('\n')+'\n'),limitations:['Isolated Rust private-work-array algorithm; not yet connected to VM Array.prototype.sort.','VM adapter must preserve original receiver snapshot/read/write semantics, comparator ToNumber/NaN conversion, GC roots, exceptions, undefined compaction and original array mutations performed by comparator.','Lengths64+ fail closed; exact V8 TimSort merge/gallop logic remains pending.','No throughput qualification follows from sorting component parity.']};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});await writeFile(resolve(root,'benchmarks/validation/v8-small-sort.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({cases:report.cases,orderedComparatorCalls:comparisonCount,throwingCases,result:report.result},null,2));
