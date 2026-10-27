import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { fromBits } from './rng-trace.mjs';

const root=resolve(import.meta.dirname,'..');
assert.ok(process.argv[2],'Usage: node tools/probe-oracle-tiers.mjs COMPILED_DAMAGE_RUNNER [--repeats N]');
const binary=resolve(process.argv[2]),repeatAt=process.argv.indexOf('--repeats');
const repeats=repeatAt<0?3:Number(process.argv[repeatAt+1]);
assert.ok(Number.isSafeInteger(repeats)&&repeats>=2,'At least two repetitions are required');
const directory=resolve(root,'work/oracle-tier-probe');await mkdir(directory,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const binarySha256=hash(await readFile(binary));
function differences(left,right){
 let changedCases=0,changedValues=0,nonNaNValueDifferences=0,otherStateDifferences=0;const first=[];
 for(let i=0;i<left.length;i++){
  const a=left[i],b=right[i];assert.equal(a.input,b.input,`Input bit pattern changed at case ${i}`);let changed=false;
  for(let j=0;j<a.expected.values.length;j++)if(a.expected.values[j]!==b.expected.values[j]){
   const av=a.expected.values[j],bv=b.expected.values[j];changed=true;changedValues++;
   if(!(Number.isNaN(fromBits(av))&&Number.isNaN(fromBits(bv))))nonNaNValueDifferences++;
   if(first.length<8)first.push({case:i,output:j,left:av,right:bv,input:a.input});
  }
  const {values:_a,...restA}=a.expected,{values:_b,...restB}=b.expected;
  if(JSON.stringify(restA)!==JSON.stringify(restB)){otherStateDifferences++;changed=true;}
  if(changed)changedCases++;
 }
 return{changedCases,changedValues,nonNaNValueDifferences,otherStateDifferences,first};
}
const groups=[],runs=[];let firstCapture,inputSha256,rustOutputSha256;
for(const [mode,flags] of [['default',[]],['jitless',['--jitless']],['no-opt',['--no-opt']]]){
 let coldBaseline;
 for(const warmups of [0,2]){
  const group={mode,flags,warmups,runs:[]};let groupBaseline;
  for(let repeat=0;repeat<repeats;repeat++){
   const capture=resolve(directory,`${mode}-warm${warmups}-${repeat}.json`);
   const args=[...flags,'tools/check-damage.mjs',binary,'--nan=semantic','--no-metadata-write','--capture-raw',capture,'--warmup-corpus',String(warmups)];
   console.log(`Capturing ${mode}, warmup corpora ${warmups}, repetition ${repeat+1}/${repeats}`);
   const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});
   if(result.error)throw result.error;assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
   const data=JSON.parse(await readFile(capture,'utf8')),raw=data.rawCapture;assert.equal(raw.length,20000);
   const inputHash=hash(raw.map(row=>row.input).join('\n')),rustHash=hash(JSON.stringify(raw.map(row=>row.actual))),sourceHash=hash(JSON.stringify(raw.map(row=>row.expected)));
   inputSha256??=inputHash;rustOutputSha256??=rustHash;
   assert.equal(inputHash,inputSha256,'The experiment must use identical input bits in every run');
   assert.equal(rustHash,rustOutputSha256,'The identical compiled runner changed raw outputs');
   const record={mode,flags,warmups,repeat,sourceOutputSha256:sourceHash,versusFirstRun:firstCapture?differences(firstCapture,raw):null,versusGroupFirst:groupBaseline?differences(groupBaseline,raw):null,versusModeColdFirst:coldBaseline?differences(coldBaseline,raw):null};
   groupBaseline??=raw;if(warmups===0)coldBaseline??=raw;firstCapture??=raw;
   runs.push(record);group.runs.push(runs.length-1);
  }
  group.uniqueRawSourceHashes=[...new Set(group.runs.map(i=>runs[i].sourceOutputSha256))];groups.push(group);
 }
}
assert.equal(hash(await readFile(binary)),binarySha256,'Compiled runner changed during experiment');
const report={version:1,createdAt:new Date().toISOString(),referenceRuntime:process.version,v8:process.versions.v8,platform:process.platform,architecture:process.arch,binarySha256,inputSha256,rustOutputSha256,casesPerRun:20000,repeats,rawValuesPreserved:true,nanNormalization:false,source: firstCapture?JSON.parse(await readFile(resolve(directory,'default-warm0-0.json'),'utf8')).provenance:[],groups,runs,scope:'Raw original damage source outputs across fresh Node processes and warm tiers. Same binary and identical serialized inputs throughout; not a battle equivalence or throughput qualification.'};
await writeFile(resolve(root,'work/oracle-tier-probe-summary.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(groups));
