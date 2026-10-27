import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {emitBattleBoundaryNDJSON,decodeBattleBoundaryNDJSON} from './battle-boundary-ndjson.mjs';
import {validateBattleBoundarySchema} from './validate-battle-boundary-schema.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-ndjson-review'),sha=value=>createHash('sha256').update(value).digest('hex');await mkdir(directory,{recursive:true});
const files=['tools/battle-boundary-ndjson.mjs','tools/tests/battle-boundary-ndjson.test.mjs','tools/tests/battle-boundary-ndjson-independent.test.mjs','tools/review-battle-boundary-ndjson.mjs','tools/battle-boundary-state-trace.js','tools/validate-battle-boundary-schema.mjs','config/native-compiler-static-hermes.json','config/source-oracle-runtime.json'];
const inputs={};for(const file of files)inputs[file]=sha(await readFile(resolve(root,file)));
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
const testArgs=[...profile.rawBitReferenceFlags,'--test','--test-reporter=tap','tools/tests/battle-boundary-ndjson.test.mjs','tools/tests/battle-boundary-ndjson-independent.test.mjs'];
const tests=spawnSync(process.execPath,testArgs,{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''},maxBuffer:4*1024*1024});assert.equal(tests.status,0,tests.stdout+tests.stderr);assert.match(tests.stdout,/# fail 0\b/);
const context=createContext(constants.DONT_CONTEXTIFY);context.digest=text=>sha(text);
runInContext(`var ed={Unit:function(){},rand:function(v){return v},srand:function(){},_battleEngineInstance:{unit_list:[],dead_unit_list:[],pet_list:[],n:-0},clientCall_list:[]};var clientCall=function(cb){ed.clientCall_list.push(cb)};var runtime={ed:ed,callbacks:{sceneHost:{snapshot:function(){}}}};`,context);
runInContext(await readFile(resolve(root,'tools/battle-boundary-state-trace.js'),'utf8'),context);
runInContext(`var t=installBattleBoundaryStateTrace(runtime,{digest:digest});t.record('battle:entered',{});var report={completed:1,totalCallbacks:0,unicode:'Ω😀\\n\\u2028',results:[{result:'victory',rngBits:'7ff8000000000042'}],trace:t.stop({status:'completed',running:false,ticks:0,result:'victory'})};`,context);
const expected=JSON.parse(runInContext('JSON.stringify(report)',context));assert.equal(validateBattleBoundarySchema(expected.trace).passed,true);
const script='var report=JSON.parse('+JSON.stringify(JSON.stringify(expected))+');\n('+emitBattleBoundaryNDJSON.toString()+')(report,print);\n';
const js=resolve(directory,'probe.js');await writeFile(js,script);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),build=resolve(root,'work/downloads/hermes-build'),compiler=resolve(build,'bin/shermes'),vm=resolve(build,'lib/libhermesvm.so'),c=resolve(directory,'probe.c'),binary=resolve(directory,'probe');
const vmSHA=sha(await readFile(vm));
function run(command,args){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const emitArgs=['-O','-emit-c',js,'-o',c];run(compiler,emitArgs);
const ccArgs=[c,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')];
for(const lib of['lib','jsi','tools/shermes']){const path=resolve(build,lib);ccArgs.push('-L'+path,'-Wl,-rpath,'+path);}ccArgs.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',binary);run('cc',ccArgs);
const execution=run(binary,[]),actual=decodeBattleBoundaryNDJSON(execution.stdout,{exitCode:execution.status});assert.deepEqual(actual,expected);const schema=validateBattleBoundarySchema(actual.trace);assert.equal(schema.passed,true,JSON.stringify(schema));
const nodeRows=[];emitBattleBoundaryNDJSON(expected,text=>nodeRows.push(text));assert.deepEqual(decodeBattleBoundaryNDJSON(nodeRows.join('\n')+'\n',{exitCode:0}),expected);
assert.equal(sha(await readFile(vm)),vmSHA);for(const[file,expectedHash]of Object.entries(inputs))assert.equal(sha(await readFile(resolve(root,file))),expectedHash,'Changed NDJSON review input '+file);
const raw=JSON.stringify({expected,actual,nativeStdout:execution.stdout,nativeStderr:execution.stderr,nodeRows,testsStdout:tests.stdout,testsStderr:tests.stderr});const outputFile='benchmarks/validation/battle-boundary-ndjson-review.outputs.json';await writeFile(resolve(root,outputFile),raw+'\n');
const report={version:1,passed:true,kind:'Independent post-battle NDJSON transport review',inputs,tests:{args:testArgs,passed:true,count:Number(/# tests (\d+)/.exec(tests.stdout)[1])},nativeCodecSmoke:{passed:true,exitCode:execution.status,compilerSha256:sha(await readFile(compiler)),originalVMSha256:vmSHA,liveVMPreserved:true,sourceSha256:sha(script),generatedCSha256:sha(await readFile(c)),binarySha256:sha(await readFile(binary)),emitArgs,ccArgs,schema},outputs:{file:outputFile,sha256:sha(raw+'\n')},findings:[
 'Emitter copies only terminal report and trace metadata, then serializes every indexed snapshot and event without modifying deeply frozen input. Per-row size limit is sixteen Mi UTF-16 code units; this is deliberately a string bound, not a UTF-8 byte claim.',
 'Decoder requires explicit numeric process exit zero, exactly one header, ordered complete snapshot/event phases, unique snapshot hashes, exact header/footer counts and final battle completion. Unknown, duplicated, truncated, malformed, re-ordered or extra records fail.',
 'Codec transports JSON data; final qualification must additionally run strict typed schema/hash validation and exact source/native event, snapshot-pool and raw terminal-report comparison.',
 'Actual tiny Static Hermes serializer output roundtrips the entire valid typed trace and unicode terminal report exactly against Node, then passes the supplemental strict schema. This is a transport-only smoke check, not a completed actual native battle trace.'
],actualNativeBattleTraceCompared:false,qualifiesFor10000Target:false};
await writeFile(resolve(root,'benchmarks/validation/battle-boundary-ndjson-independent-review.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,tests:report.tests.count,nativeCodecSmoke:true,actualNativeBattleTraceCompared:false}));
