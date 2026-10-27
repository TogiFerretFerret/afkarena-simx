import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {parse} from '@babel/parser';
import assert from 'node:assert/strict';
import {createBootstrapRuntime} from './bootstrap-runtime.mjs';
import {instantiateScenario} from './scenario-factory.mjs';
import {compareNativeReports,compareHostInputConsumption} from './native-report-compare.mjs';

const intrinsicToString=Function.prototype.toString,intrinsicApply=Reflect.apply;
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/source-callback-codes');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1],...process.argv.slice(2)],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(child.status??1);}
await mkdir(directory,{recursive:true});
const inputProofFile='work/battle-boundary-trace/source-proof.json',inputProof=JSON.parse(await readFile(resolve(root,inputProofFile)));
assert.equal(inputProof.passed,true);assert.equal(inputProof.completed,1);
const dependencies=new Map();
async function bind(file,expected){const bytes=await readFile(resolve(root,file)),actual=sha(bytes);if(expected!==undefined)assert.equal(actual,expected,'Changed source input '+file);dependencies.set(file,actual);return bytes;}
await bind(inputProofFile);
for(const row of inputProof.dependenciesAtFinish){assert.equal(row.matched,true);await bind(row.file,row.sha256);}
for(const file of ['tools/profile-source-callback-codes.mjs','tools/bootstrap-callbacks.mjs','tools/bootstrap-runtime.mjs','tools/native-report-compare.mjs','config/source-oracle-runtime.json'])await bind(file);
const tape=JSON.parse(await bind(inputProof.hostInputs.file,inputProof.hostInputs.sha256)),wire=JSON.parse(await bind(inputProof.scenario.file,inputProof.scenario.sha256));
assert.equal(tape.clock.length,260);assert.equal(tape.random.length,2);
const emitter=(await readFile(resolve(root,'tools/emit-native-oracle.mjs'))).toString(),tree=parse(emitter,{sourceType:'module'});
const names=['__nativeBits','__nativePrimitiveState','__nativeUnitState','__nativeRun'];
const helpers=names.map(name=>{const node=tree.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node);const text=emitter.slice(node.start,node.end);assert.equal(sha(text),inputProof.helpers.find(h=>h.name===name).sha256);return text;});
const runBattle=new Function('instantiateScenario',helpers.join('\n')+'\nreturn __nativeRun;')(instantiateScenario);
const sourceFiles=[...dependencies.keys()].filter(file=>file.startsWith('src/srcmodule/')&&file.endsWith('.js'));
const sources=await Promise.all(sourceFiles.map(async file=>({file,text:(await readFile(resolve(root,file))).toString(),sha256:dependencies.get(file)})));
function mapping(code){const matches=[];for(const source of sources){let from=0;while(from<=source.text.length){const start=source.text.indexOf(code,from);if(start<0)break;matches.push({file:source.file,fileSha256:source.sha256,start,end:start+code.length,offsetUnit:'UTF-16 code units',codeSha256:sha(source.text.slice(start,start+code.length)),contextBefore:source.text.slice(Math.max(0,start-180),start),contextAfter:source.text.slice(start+code.length,start+code.length+80)});from=start+Math.max(1,code.length);}}return matches;}
function syntax(code){try{const ast=parse('('+code+')',{sourceType:'script'}),calls=[],identifiers=new Set();function walk(node,parent,key){if(!node||typeof node!=='object')return;if(node.type==='CallExpression')calls.push({callee:code.slice(Math.max(0,node.callee.start-1),node.callee.end-1),argumentCount:node.arguments.length});if(node.type==='Identifier'&&!(parent?.type==='MemberExpression'&&key==='property'&&!parent.computed)&&!(parent?.type==='ObjectProperty'&&key==='key'&&!parent.computed))identifiers.add(node.name);for(const [k,value]of Object.entries(node))if(k!=='loc'&&k!=='extra'){if(Array.isArray(value))for(const child of value)walk(child,node,k);else if(value&&typeof value==='object')walk(value,node,k);}}walk(ast,null,null);return{calls,identifierNames:[...identifiers].sort(),bindingPolicy:'Identifier spellings and direct call expressions only. No captured values were read, frozen or classified as immutable.'};}catch(error){return{parseError:error.message,calls:[],identifierNames:[]};}}
async function reference(observed){
 let randomIndex=0;const byFunction=new WeakMap(),byCode=new Map(),sequence=createHash('sha256');let before=0,after=0,typesRejected=0;
 const runtime=await createBootstrapRuntime({eagerBattle:true,observeClassManager:true,hostRandom(){assert.ok(randomIndex<tape.random.length);return tape.random[randomIndex++];},hostClock:{mode:'replay',tape:tape.clock}});
 let originalDescriptor=null,wrapper=null;
 if(observed){const host=runtime.callbacks.sceneHost;originalDescriptor=Object.getOwnPropertyDescriptor(host,'snapshot');assert.ok(originalDescriptor&&typeof originalDescriptor.value==='function');const original=originalDescriptor.value;
  wrapper=function(callback){const result=intrinsicApply(original,this,arguments);if(arguments.length===0){before++;return result;}after++;if(typeof callback!=='function'){typesRejected++;throw new Error('Nonfunction callback after snapshot');}let record=byFunction.get(callback);if(!record){const code=intrinsicApply(intrinsicToString,callback,[]);record=byCode.get(code);if(!record){record={codeSha256:sha(code),source:code,count:0,uniqueFunctions:0,firstOrdinal:after-1,lastOrdinal:after-1};byCode.set(code,record);}record.uniqueFunctions++;byFunction.set(callback,record);}record.count++;record.lastOrdinal=after-1;sequence.update(Buffer.from(record.codeSha256,'hex'));return result;};
  Object.defineProperty(host,'snapshot',{...originalDescriptor,value:wrapper});
 }
 const report=runBattle(runtime,wire,1,0,Date.now,'final');runtime.clock.finish();assert.equal(randomIndex,2);
 report.hostInputConsumption={random:randomIndex,clock:runtime.clock.stats()};
 if(observed){assert.equal(Object.getOwnPropertyDescriptor(runtime.callbacks.sceneHost,'snapshot').value,wrapper);Object.defineProperty(runtime.callbacks.sceneHost,'snapshot',originalDescriptor);assert.equal(before,report.totalCallbacks);assert.equal(after,report.totalCallbacks);assert.equal(typesRejected,0);}
 return{report,counts:{before,after,typesRejected,codeKinds:byCode.size,uniqueFunctions:[...byCode.values()].reduce((sum,r)=>sum+r.uniqueFunctions,0),orderedCodeHash:observed?sequence.digest('hex'):null},rows:[...byCode.values()].sort((a,b)=>b.count-a.count||a.codeSha256.localeCompare(b.codeSha256))};
}
const untraced=await reference(false);await writeFile(resolve(directory,'untraced.json'),JSON.stringify(untraced.report)+'\n');
const observed=await reference(true);await writeFile(resolve(directory,'observed.json'),JSON.stringify(observed.report)+'\n');
const difference=compareNativeReports(observed.report,untraced.report),prior=JSON.parse(await readFile(inputProof.reports.untraced));
assert.equal(compareNativeReports(untraced.report,prior),null,'Fresh untraced source differs from frozen boundary reference');
assert.equal(compareHostInputConsumption(untraced.report.hostInputConsumption,inputProof.hostInputs),null);assert.equal(compareHostInputConsumption(observed.report.hostInputConsumption,inputProof.hostInputs),null);
for(const record of observed.rows){record.percent=100*record.count/observed.report.totalCallbacks;record.sourceByteLength=Buffer.byteLength(record.source);record.sourceRanges=mapping(record.source);record.sourceMapping=record.sourceRanges.length===1?'unique exact original source literal':record.sourceRanges.length>1?'ambiguous exact original source literals':'no exact original source literal';record.syntax=syntax(record.source);}
const rowSum=observed.rows.reduce((sum,row)=>sum+row.count,0);assert.equal(rowSum,observed.report.totalCallbacks);
const dependenciesAtFinish=[];for(const [file,sha256]of dependencies){const matched=sha(await readFile(resolve(root,file)))===sha256;dependenciesAtFinish.push({file,sha256,matched});assert.equal(matched,true,'Changed profile source '+file);}
const stamp=new Date().toISOString().replaceAll(':','-'),prefix='benchmarks/results/'+stamp+'-source-callback-codes',artifacts=[];
for(const [label,value]of [['untraced',untraced.report],['observed',observed.report],['host-inputs',tape],['scenario',wire]]){const raw=Buffer.from(JSON.stringify(value)+'\n'),file=prefix+'.'+label+'.json.gz',compressed=gzipSync(raw,{level:9});await writeFile(resolve(root,file),compressed);artifacts.push({label,file,sha256:sha(compressed),uncompressedSha256:sha(raw),uncompressedBytes:raw.length});}
const report={version:1,passed:difference===null,difference,kind:'Actual queued callback code frequency from original-source battle',scope:'One fixed callback-only original-source battle. A new observer runs only after the unchanged source snapshot(callback), after the original queue invokes each callback exactly once. It calls captured intrinsic Function.prototype.toString with the actual function as receiver and never invokes that callback. No game source, callback closure, queue loop or active adapter helper is edited. This is diagnostic code frequency, not a performance result or whole-program trace.',oracleProfile:profile,completed:observed.report.completed,results:observed.report.results,totalCallbacks:observed.report.totalCallbacks,hostInputConsumption:observed.report.hostInputConsumption,classManagerCounters:observed.report.classManagerCounters,observer:observed.counts,rowSum,rows:observed.rows,referenceMatchedFrozenBoundarySource:true,completeRawTerminalReportMatched:difference===null,sourceProof:{file:inputProofFile,sha256:dependencies.get(inputProofFile)},hostInputs:inputProof.hostInputs,scenario:inputProof.scenario,helpers:inputProof.helpers,dependenciesAtFinish,artifacts,qualifiesFor10000Target:false,limitations:['Code equality does not imply identical captured bindings or behavior; distinct closures are counted separately but captured values are never inspected.','Exact literal matches can be ambiguous; all matching original ranges are retained without claiming a unique closure creation site.','Frequency is executions, not CPU cost. Callback bodies may merely dispatch methods whose work is unmeasured here.','Original FIFO queue capture, shift, appended callbacks, before/after snapshots and callback invocation remain in the unchanged source drain.','Actor/effect/view lifecycle remains outside the callback-only adapter; one roster is not a random-battle qualification corpus.'],producer:{file:'tools/profile-source-callback-codes.mjs',sha256:dependencies.get('tools/profile-source-callback-codes.mjs')}};
await writeFile(resolve(root,prefix+'.json'),JSON.stringify(report,null,2)+'\n');await writeFile(resolve(root,'benchmarks/validation/source-callback-codes.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file:prefix+'.json',passed:report.passed,totalCallbacks:report.totalCallbacks,observer:report.observer,rows:report.rows.map(r=>({count:r.count,uniqueFunctions:r.uniqueFunctions,codeSha256:r.codeSha256,source:r.source,sourceRanges:r.sourceRanges.length}))}));assert.equal(difference,null,'Code observer changed a raw terminal field');
