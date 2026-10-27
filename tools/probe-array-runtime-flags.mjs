import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/array-runtime-flags');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);assert.equal(process.platform,profile.platform);assert.equal(process.arch,profile.architecture);
const hash=value=>createHash('sha256').update(value).digest('hex');
const variants=[
 ['jitless',['--jitless']],
 ['no-ic',['--jitless','--no-use-ic']],
 ['no-sites',['--jitless','--no-allocation-site-tracking']],
 ['no-ic-no-sites',['--jitless','--no-use-ic','--no-allocation-site-tracking']],
 ['eager-feedback',['--jitless','--no-lazy-feedback-allocation']],
 ['no-ic-eager',['--jitless','--no-use-ic','--no-lazy-feedback-allocation']],
 ['no-pretenuring',['--jitless','--no-allocation-site-pretenuring']],
 ['no-ic-no-sites-no-pretenuring',['--jitless','--no-use-ic','--no-allocation-site-tracking','--no-allocation-site-pretenuring']],
 ['no-unbox',['--jitless','--no-unbox-double-arrays']],
 ['no-ic-no-unbox',['--jitless','--no-use-ic','--no-unbox-double-arrays']],
 ['no-ic-eager-no-unbox',['--jitless','--no-use-ic','--no-lazy-feedback-allocation','--no-unbox-double-arrays']],
];
const queryBits=[
 ['fff8000000000000','7ff0000000000000','7ff0000000000000','0000000000000000'],
 ['7ff8123456789abc','fff8abcdef012345','7ff8123456789abc','fff8abcdef012345'],
 ['fff8abcdef012345','7ff8123456789abc','fff8abcdef012345','7ff8123456789abc'],
 ['7ff0123456789abc','fff0abcdef012345','7ff0123456789abc','fff0abcdef012345'],
 ['0000000000000000','7ff0000000000000','7ff0000000000000','0000000000000000'],
 ['8000000000000000','fff0000000000000','7ff0000000000000','0000000000000000'],
 ['7fefffffffffffff','7fefffffffffffff','0000000000000001','8000000000000001'],
 ['3ff0000000000000','bff0000000000000','8000000000000000','0000000000000000'],
];
const view=new DataView(new ArrayBuffer(8));
function number(bits){view.setBigUint64(0,BigInt(`0x${bits}`));return view.getFloat64(0)}
function bits(value){view.setFloat64(0,value);return view.getBigUint64(0).toString(16).padStart(16,'0')}
// Tagged element storage preserves input payloads even when experimental flags
// alter double-array stores. The arrays contain only Numbers when source sees them.
function vector(a,b){const result=[{},{}];result[0]=a;result[1]=b;assert.equal(bits(result[0]),bits(a));assert.equal(bits(result[1]),bits(b));return result}
function decode(values){const result=values.map(()=>({}));for(let i=0;i<values.length;i++)result[i]=number(values[i]);return result}
const manifest=JSON.parse(await readFile(resolve(root,'config/numeric-kernels.ir.json'),'utf8')),original=await readFile(resolve(root,manifest.source),'utf8');
const fixtures=[{name:'literal',source:'function(a,b){return[a,b]}',kind:'literal'}];
for(const name of ['ed.edpMult','ed.edpCompMult','ed.edpAdd']){
 const def=manifest.kernels.find(k=>k.sourceName===name),source=original.slice(def.start,def.end);assert.equal(hash(source),def.sourceSha256);
 fixtures.push({name,source,kind:name==='ed.edpMult'?'scalar':'vector',sourceSha256:def.sourceSha256});
}
const histories=['cold','smi','double','witness','reverse-witness','nan-first','long-mixed','gc-between'];
function input(args){return args.map(bits)}
function invoke(fn,kind,args){if(kind==='literal')return fn(args[0],args[1]);if(kind==='scalar')return fn(vector(args[0],args[1]),args[2]);return fn(vector(args[0],args[1]),vector(args[2],args[3]))}
const workerAt=process.argv.indexOf('--worker');
if(workerAt>=0){
 const variant=variants.find(([name])=>name===process.argv[workerAt+1]);assert.ok(variant);
 assert.deepEqual(process.execArgv,[...variant[1],'--expose-gc']);assert.equal(process.env.NODE_OPTIONS??'','');assert.equal(typeof globalThis.gc,'function');
 const rows=[];
 for(const fixture of fixtures)for(const history of histories){
  const fn=runInNewContext(`(${fixture.source})`);
  const finite=[0,-0,1,-1,.5,Number.MIN_VALUE,-Number.MIN_VALUE,Number.MAX_VALUE,-Number.MAX_VALUE];
  let warm=[];
  if(history==='smi')warm=Array.from({length:32},(_,i)=>[i,i+1,i+2,i+3]);
  if(history==='double')warm=Array.from({length:32},(_,i)=>[i+.1,i+.2,i+.3,i+.4]);
  if(history==='witness'||history==='reverse-witness'){warm=finite.map(y=>[0,y,y,0]);if(history==='reverse-witness')warm.reverse()}
  if(history==='nan-first')warm=queryBits.slice(0,4).map(decode);
  if(history==='long-mixed')warm=Array.from({length:20000},(_,i)=>i%31===0?decode(queryBits[i%queryBits.length]):[i%2?-i:i,i/3,i/7,i%5?-0:0]);
  for(let i=0;i<warm.length;i++){invoke(fn,fixture.kind,warm[i]);if(history==='long-mixed'&&i%1024===0)globalThis.gc()}
  // Exercise both original and reversed query order on each existing literal site.
  for(let pass=0;pass<4;pass++)for(const q of pass%2?[...queryBits.keys()].reverse():queryBits.keys()){
   if(history==='gc-between')globalThis.gc();const args=decode(queryBits[q]);assert.deepEqual(input(args),queryBits[q]);
   const result=invoke(fn,fixture.kind,args);rows.push({fixture:fixture.name,history,pass,query:q,input:input(args),output:[bits(result[0]),bits(result[1])]});
   if(history==='gc-between')globalThis.gc();
  }
 }
 await writeFile(resolve(process.argv[workerAt+2]),JSON.stringify({variant:variant[0],flags:process.execArgv,rows})+'\n');
}else{
 await mkdir(directory,{recursive:true});const reports=[];
 for(const [name,flags] of variants){
  const runs=[];let firstHash;
  for(let repeat=0;repeat<3;repeat++){
   console.log(`Probing ${name} repetition ${repeat+1}/3`);const path=resolve(directory,`${name}-${repeat}.json`);
   const result=spawnSync(process.execPath,[...flags,'--expose-gc','tools/probe-array-runtime-flags.mjs','--worker',name,path],{cwd:root,env:{...process.env,NODE_OPTIONS:''},encoding:'utf8',maxBuffer:8*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
   const data=JSON.parse(await readFile(path,'utf8')),groups={};
   for(const row of data.rows){assert.deepEqual(row.input,queryBits[row.query]);const key=`${row.fixture}:${row.query}`;(groups[key]??=new Map()).set(JSON.stringify(row.output),row)}
   const unstable=Object.entries(groups).filter(([,values])=>values.size>1).map(([key,values])=>({key,outputs:[...values.values()].map(row=>({history:row.history,pass:row.pass,input:row.input,output:row.output}))}));
   const rowsSha256=hash(JSON.stringify(data.rows));firstHash??=rowsSha256;
   runs.push({repeat,rowsSha256,identicalToFirstProcess:rowsSha256===firstHash,rows:data.rows.length,historyDependentGroups:unstable.length,unstable});
  }
  reports.push({name,flags,testOnlyFlags:['--expose-gc'],runs,historyIndependentAcrossObservedInputs:runs.every(run=>run.historyDependentGroups===0),processRepeatable:runs.every(run=>run.identicalToFirstProcess)});
 }
 const report={version:1,createdAt:new Date().toISOString(),existingProfile:profile,policyChanged:false,noNormalization:true,fixtures,histories,queries:queryBits,queryPasses:4,repetitions:3,reports,scope:'Isolated supported-V8-flag experiments over actual original source functions; no reference policy change, no prewarm normalization and no claim of exhaustive storage-state equivalence.'};
 await writeFile(resolve(root,'work/array-runtime-flags-summary.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(reports.map(({name,historyIndependentAcrossObservedInputs,processRepeatable})=>({name,historyIndependentAcrossObservedInputs,processRepeatable}))));
}
