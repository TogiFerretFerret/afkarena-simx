import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { openSync, closeSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createContext, runInContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { instrumentRng,bits,fromBits,compareTrace,parseTraceLine } from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..');
if(!process.argv[2])throw new Error('Usage: node tools/check-rng.mjs BINARY [--nan=semantic]');
// Default is raw-bit equality, including NaN sign/payload. Semantic NaN comparison is explicit.
const nanPolicy=process.argv.includes('--nan=semantic')?'semantic':'bits';
const manifest=JSON.parse(await readFile(resolve(root,'config/rng-translation.json'),'utf8'));
const source=await readFile(resolve(root,manifest.source),'utf8');
let events=[],pendingLog,context;
function record(kind,value=null){
  events.push({kind,value:value===null?null:bits(value),state:bits(context.random_seed),initial:context.ed.init_battle_seed===undefined?null:bits(context.ed.init_battle_seed)});
}
context=createContext({
  ed:{btLog:{append:()=>record(pendingLog.kind,pendingLog.value)}},
  cc:{error:()=>record('invalid_seed_callback')},
  __traceValue:(kind,value)=>{
    record(kind,value);
    if(kind==='seed_log_value')pendingLog={kind:'seed_log_callback',value};
    if(kind==='random_log_value')pendingLog={kind:'random_log_callback',value};
    return value;
  },
});
runInContext(`var random_seed=1; var multiplier=${source.slice(manifest.constants.multiplier.start,manifest.constants.multiplier.end)}; var moder=${source.slice(manifest.constants.moder.start,manifest.constants.moder.end)};`,context);
for(const fn of manifest.functions){
  const code=source.slice(fn.start,fn.end);
  assert.equal(createHash('sha256').update(code).digest('hex'),fn.sha256,`Stale source location for ${fn.name}`);
  runInContext(`${fn.name}=${instrumentRng(code,fn.name)};`,context);
}
const seeds=[0,-0,NaN,Infinity,-Infinity,1,-1,.5,-.5,Number.MIN_VALUE,-Number.MIN_VALUE,
  Number.MAX_VALUE,-Number.MAX_VALUE,34359738337,34359738338,2**53-1,2**53,2**-1022];
for(let i=1;i<=2048;i++)seeds.push(i);
let state=0x9e3779b97f4a7c15n;
for(let i=0;i<2048;i++){
  state^=state<<13n;state=BigInt.asUintN(64,state);state^=state>>7n;state^=state<<17n;state=BigInt.asUintN(64,state);
  seeds.push(fromBits(state.toString(16)));
}
await mkdir(resolve(root,'work'),{recursive:true});
const tracePath=resolve(root,'work/rng-rust.trace');
const fd=openSync(tracePath,'w');
let result;
try{result=spawnSync(resolve(process.argv[2]),[],{input:seeds.map(bits).join('\n')+'\n',encoding:'utf8',stdio:['pipe',fd,'pipe']});}
finally{closeSync(fd);}
if(result.error)throw result.error;
assert.equal(result.status,0,result.stderr);
let index=0,eventCount=0,nanBitDifferences=0;
const lines=createInterface({input:createReadStream(tracePath),crlfDelay:Infinity});
for await(const line of lines){
  assert.ok(index<seeds.length,'Unexpected extra trace');
  events=[];
  assert.equal(context.ed.srand(seeds[index]),undefined);
  record('return_undefined');
  for(let j=0;j<32;j++){context.ed.randDontChangeSeed();context.ed.rand();}
  const actual=parseTraceLine(line);
  const comparison=compareTrace(events,actual,{nanPolicy});
  if(!comparison.match){
    const at=comparison.index;
    const report={seedIndex:index,inputBits:bits(seeds[index]),nanPolicy,...comparison,
      expectedContext:events.slice(Math.max(0,at-3),at+4),actualContext:actual.slice(Math.max(0,at-3),at+4)};
    const path=resolve(root,'work/rng-first-divergence.json');
    await writeFile(path,JSON.stringify(report,null,2)+'\n');
    throw new Error(`RNG trace diverged at seed ${index}, event ${at}, field ${comparison.field??comparison.reason}; see work/rng-first-divergence.json`);
  }
  eventCount+=events.length;nanBitDifferences+=comparison.nanBitDifferences;index++;
}
assert.equal(index,seeds.length);
const report={version:1,referenceRuntime:process.version,
  binarySha256:createHash('sha256').update(await readFile(resolve(process.argv[2]))).digest('hex'),
  sourceFunctions:manifest.functions.map(({name,sha256})=>({name,sha256})),
  seedCases:index,draws:index*32,eventCount,nanPolicy,nanBitDifferences,rawBitsExact:nanBitDifferences===0,
  traceFields:['kind','value','state','initial'],scope:'RNG only; no complete battle trace or exact log-string rendering yet'};
await writeFile(resolve(root,'work/rng-trace-summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
