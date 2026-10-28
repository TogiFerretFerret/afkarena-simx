import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {parse} from '@babel/parser';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';

const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);
const option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const coverageFile=resolve(root,option('--coverage','benchmarks/validation/rust-battle-compile-coverage.json'));
const output=resolve(root,option('--out','work/rust-battle-one'));
const reportFile=resolve(root,option('--report','benchmarks/validation/rust-program-one-preparation.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const coverageBytes=await readFile(coverageFile),coverage=JSON.parse(coverageBytes);
assert.equal(coverage.units.length,7);
const producerFiles=['tools/rust-port/prepare-program-workload.mjs','tools/rust-port/check-program.mjs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/statements.mjs','tools/rust-port/bindings.mjs','config/source-oracle-runtime.json'];
const producerHashes={};for(const file of producerFiles)producerHashes[file]=sha(await readFile(resolve(root,file)));
await mkdir(output,{recursive:true});await mkdir(dirname(reportFile),{recursive:true});
const functionTypes=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
function inspect(source){const nodes=[],functions=[],pending=[parse(source,{sourceType:'script'})];while(pending.length){const node=pending.pop();nodes.push(node);if(functionTypes.has(node.type))functions.push({start:node.start,end:node.end,sha256:sha(source.slice(node.start,node.end))});for(const [key,value] of Object.entries(node)){if(['loc','extra','comments','tokens'].includes(key))continue;if(Array.isArray(value)){for(const child of value)if(child&&typeof child.type==='string')pending.push(child);}else if(value&&typeof value.type==='string')pending.push(value);}}functions.sort((a,b)=>a.start-b.start||a.end-b.end);return{nodes,functions};}
function replace(source,edits){for(const edit of edits.sort((a,b)=>b.start-a.start)){assert.ok(edit.text.length<=edit.end-edit.start,'Harness edit must preserve all source offsets');source=source.slice(0,edit.start)+edit.text+' '.repeat(edit.end-edit.start-edit.text.length)+source.slice(edit.end);}return source;}
const derivedUnits=[],changes=[],functionInventory=[];
let tapeSeen=0,runSeen=0;
for(const unit of coverage.units){
 const bytes=await readFile(unit.file);assert.equal(sha(bytes),unit.sha256,'Frozen source changed');const source=bytes.toString('utf8');
 const original=inspect(source),edits=[];
 for(const node of original.nodes){
  if(node.type==='AssignmentExpression'&&node.left?.type==='Identifier'&&node.left.name==='__nativeHostInputs'){
   assert.equal(unit.index,0);assert.equal(node.operator,'=');const call=node.right;
   assert.equal(call.type,'CallExpression');assert.equal(call.callee?.object?.name,'JSON');assert.equal(call.callee?.property?.name,'parse');assert.equal(call.arguments.length,1);assert.equal(call.arguments[0].type,'StringLiteral');
   const literal=call.arguments[0],tape=JSON.parse(literal.value);assert.equal(tape.clock.length,5980);assert.equal(tape.clock.length/(20+3),260);assert.equal(tape.random.length,2);
   edits.push({start:literal.start,end:literal.end,text:JSON.stringify(JSON.stringify({...tape,clock:tape.clock.slice(0,260)}))});tapeSeen++;
  }
  if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&node.callee.name==='__nativeRun'){
   assert.equal(unit.index,6);assert.equal(node.arguments[2]?.value,20);assert.equal(node.arguments[3]?.value,3);
   edits.push({start:node.arguments[2].start,end:node.arguments[2].end,text:'1'},{start:node.arguments[3].start,end:node.arguments[3].end,text:'0'});runSeen++;
  }
 }
 const derived=replace(source,edits);assert.equal(derived.length,source.length);
 const next=edits.length?inspect(derived):original;
 assert.deepEqual(next.functions,original.functions,'A function body or its source range changed');
 functionInventory.push({index:unit.index,functions:original.functions});
 if(edits.length){
  const file=resolve(output,`unit-${unit.index}.js`);await writeFile(file,derived);
  const {manifest}=compileSource(derived,{filename:file,emitRust:false});assert.equal(manifest.unsupportedFunctions,0);
  derivedUnits.push({...unit,...manifest,index:unit.index,file,sha256:sha(derived),sourceBytes:Buffer.byteLength(derived)});
  changes.push({index:unit.index,originalFile:unit.file,originalSha256:unit.sha256,file,sha256:sha(derived),edits:edits.map(({start,end})=>({start,end})),preservedFunctionCount:original.functions.length});
 }else derivedUnits.push(unit);
}
assert.equal(tapeSeen,1);assert.equal(runSeen,1);assert.equal(changes.length,2);
const manifestFile=resolve(output,'coverage.json');
const derivedCoverage={...coverage,fixture:undefined,sources:{...coverage.sources,...producerHashes},units:derivedUnits,derivedFrom:{file:coverageFile,sha256:sha(coverageBytes)},workload:{measuredBattles:1,warmups:0,clockInputs:260,randomInputs:2},scope:'Derived single-battle diagnostic workload. Only top-level harness count literals and host-clock tape change; every source function body and source range is unchanged. Not the 20-battle benchmark or broad battle qualification.',qualifiesFor10000Target:false};
await writeFile(manifestFile,JSON.stringify(derivedCoverage,null,2)+'\n');
let oracle=null;
if(!args.includes('--skip-oracle')){
 const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
 assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
 const command=[process.execPath,...profile.rawBitReferenceFlags,resolve(root,'tools/rust-port/check-program.mjs'),'--oracle','--manifest',manifestFile];
 const result=spawnSync(command[0],command.slice(1),{cwd:root,env:{...process.env,NODE_OPTIONS:profile.rawBitReferenceNodeOptions},encoding:'utf8',maxBuffer:128*1024*1024,timeout:180000});
 const prefix=reportFile.replace(/\.json$/,'');await writeFile(prefix+'.oracle.stdout.gz',gzipSync(result.stdout??''));await writeFile(prefix+'.oracle.stderr.gz',gzipSync(result.stderr??''));
 let report=null;for(const line of (result.stdout??'').trim().split('\n').reverse()){try{const value=JSON.parse(line);if(value&&typeof value==='object'&&'completed'in value){report=value;break;}}catch{}}
 const clock=report?.hostInputConsumption?.clock;
 const passed=result.status===0&&report?.completed===1&&report.results?.length===1&&report.hostInputConsumption?.random===2&&clock?.consumed===260&&clock?.total===260&&clock?.attempts===260&&clock?.remaining===0&&clock?.finished===true&&clock?.failure===null;
 oracle={passed,command,status:result.status,signal:result.signal,error:result.error?.message??null,report,stdout:prefix+'.oracle.stdout.gz',stderr:prefix+'.oracle.stderr.gz'};
}
const changedProducerInputs=[];for(const [file,digest] of Object.entries(producerHashes))if(sha(await readFile(resolve(root,file)))!==digest)changedProducerInputs.push(file);
const changedFrozenInputs=[];for(const unit of coverage.units)if(sha(await readFile(unit.file))!==unit.sha256)changedFrozenInputs.push(unit.file);
const inventoryBytes=Buffer.from(JSON.stringify(functionInventory));await writeFile(reportFile.replace(/\.json$/,'')+'.functions.json.gz',gzipSync(inventoryBytes));
const sourceArtifacts=[];for(const change of changes){const artifact=reportFile.replace(/\.json$/,'')+`.unit-${change.index}.js.gz`;await writeFile(artifact,gzipSync(await readFile(change.file)));sourceArtifacts.push({index:change.index,file:artifact,sha256:change.sha256});}
const manifestArtifact=reportFile.replace(/\.json$/,'')+'.coverage.json.gz';await writeFile(manifestArtifact,gzipSync(await readFile(manifestFile)));
const report={version:1,prepared:true,passed:oracle?.passed===true&&changedProducerInputs.length===0&&changedFrozenInputs.length===0,qualifiesFor10000Target:false,scope:derivedCoverage.scope,originalCoverage:{file:coverageFile,sha256:sha(coverageBytes)},manifest:{file:manifestFile,sha256:sha(await readFile(manifestFile)),artifact:manifestArtifact},sourceArtifacts,workload:derivedCoverage.workload,changes,functions:{preservedCount:functionInventory.reduce((n,unit)=>n+unit.functions.length,0),inventorySha256:sha(inventoryBytes),artifact:reportFile.replace(/\.json$/,'')+'.functions.json.gz'},producerHashes,changedProducerInputs,changedFrozenInputs,oracle};
await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:reportFile,manifest:manifestFile,passed:report.passed,workload:report.workload,preservedFunctions:report.functions.preservedCount,oracle:oracle&&{passed:oracle.passed,status:oracle.status,hostInputConsumption:oracle.report?.hostInputConsumption},changedProducerInputs,changedFrozenInputs}));
if(!args.includes('--skip-oracle')&&!report.passed)process.exitCode=1;
