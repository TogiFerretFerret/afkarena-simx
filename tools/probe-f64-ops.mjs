import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
assert.ok(process.argv[2],'Usage: node --jitless tools/probe-f64-ops.mjs RUNNER');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.deepEqual(process.execArgv,profile.rawBitReferenceFlags,'Run the probe with the pinned source flags');
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.equal(process.platform,profile.platform);assert.equal(process.arch,profile.architecture);assert.equal(process.env.NODE_OPTIONS??'',profile.rawBitReferenceNodeOptions);
const buffer=new ArrayBuffer(8),view=new DataView(buffer);
function fromBits(bits){view.setBigUint64(0,BigInt(`0x${bits}`));return view.getFloat64(0)}
function bits(value){view.setFloat64(0,value);return view.getBigUint64(0).toString(16).padStart(16,'0')}
const inputs=['0000000000000000','8000000000000000','3ff0000000000000','bff0000000000000','3fb999999999999a','7ff0000000000000','fff0000000000000','0000000000000001','8000000000000001','7fefffffffffffff','ffefffffffffffff','7ff8000000000000','fff8000000000000','7ff8000000000001','fff8000000000002','7ff8123456789abc','fff8abcdef012345','7ff0000000000001','fff0000000000002','7ff0123456789abc','fff0abcdef012345'];
let random=0x4794c78284395193n;
function nextBits(){random=BigInt.asUintN(64,random^(random<<13n));random=BigInt.asUintN(64,random^(random>>7n));random=BigInt.asUintN(64,random^(random<<17n));return random}
for(let i=0;i<64;i++){
 const payload=(nextBits()&0x0007ffffffffffffn)||1n,sign=i%2?0x8000000000000000n:0n,quiet=i%4<2?0x0008000000000000n:0n;
 inputs.push((sign|0x7ff0000000000000n|quiet|payload).toString(16).padStart(16,'0'));
}
const names=['add','sub','mul','div','min','max'],source=['function(a,b){return a+b}','function(a,b){return a-b}','function(a,b){return a*b}','function(a,b){return a/b}','function(a,b){return Math.min(a,b)}','function(a,b){return Math.max(a,b)}'];
const functions=source.map(text=>runInNewContext(`(${text})`));
const cases=inputs.flatMap(a=>inputs.map(b=>({a,b})));
for(let i=0;i<10000;i++)cases.push({a:nextBits().toString(16).padStart(16,'0'),b:nextBits().toString(16).padStart(16,'0')});
const result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(c=>`${c.a} ${c.b}`).join('\n')+'\n',encoding:'utf8',maxBuffer:32*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
const native=result.stdout.trim().split('\n').map(JSON.parse);assert.equal(native.length,cases.length);
const nativeNames=['rust-add','rust-sub','rust-mul','rust-div','sse-left-add','sse-left-sub','sse-left-mul','sse-left-div','sse-right-add','sse-right-mul','helper-add','helper-sub','helper-mul','helper-div','helper-min','helper-max'];
const candidates=[[0,0],[1,1],[2,2],[3,3],[4,0],[5,1],[6,2],[7,3],[8,0],[9,2],[10,0],[11,1],[12,2],[13,3],[14,4],[15,5]];
const counts=Object.fromEntries(nativeNames.map(name=>[name,{differences:0,first:[]}])) ;
const rows=cases.map((input,i)=>{
 const a=fromBits(input.a),b=fromBits(input.b);assert.equal(bits(a),input.a);assert.equal(bits(b),input.b);
 const expected=functions.map(fn=>bits(fn(a,b)));
 for(const [n,j] of candidates)if(native[i][n]!==expected[j]){const record=counts[nativeNames[n]];record.differences++;if(record.first.length<4)record.first.push({input,expected:expected[j],actual:native[i][n]});}
 return{...input,source:expected,native:native[i]};
});
for(const name of nativeNames.filter(name=>name.startsWith('helper-')))assert.equal(counts[name].differences,0,`${name} does not match the pinned source`);
const hash=value=>createHash('sha256').update(value).digest('hex');
const report={version:1,referenceProfile:profile,cases:cases.length,distinctDirectedValues:inputs.length,randomPairs:10000,helperOutputValues:cases.length*6,operations:names,nativeOperations:nativeNames,source,counts,binarySha256:hash(await readFile(resolve(process.argv[2]))),noNormalization:true,rawRowsSha256:hash(JSON.stringify(rows)),sha256:{}};
for(const file of ['tools/probe-f64-ops.mjs','tools/probe-f64-ops.rs','crates/battle-core/src/js_math.rs'])report.sha256[file]=hash(await readFile(resolve(root,file)));
await writeFile(resolve(root,'work/f64-operation-probe.json'),JSON.stringify({...report,rows})+'\n');
await writeFile(resolve(root,'work/f64-operation-probe-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(counts,null,2));
