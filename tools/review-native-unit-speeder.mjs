import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
import {unitSpeederProbeSource} from './native-unit-speeder-cases.mjs';
import {patchUnitSpeederC} from './native-unit-speeder-patch.mjs';
import {analyzeUnitSpeederLiveness} from './audit-unit-speeder-liveness.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'work/native-unit-speeder-review'),sha=b=>createHash('sha256').update(b).digest('hex');
if(!process.execArgv.includes('--jitless')){const child=spawnSync(process.execPath,['--jitless',process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(child.status??1);}
await mkdir(dir,{recursive:true});
const proofFile='benchmarks/validation/native-unit-speeder.json',proofBytes=await readFile(resolve(root,proofFile)),proof=JSON.parse(proofBytes),build=JSON.parse(await readFile(resolve(root,proof.buildProof.file)));
assert.equal(proof.passed,true);for(const [file,hash]of Object.entries(proof.sources))assert.equal(sha(await readFile(resolve(root,file))),hash,file);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json')));
const gcSourceFile=resolve(root,'work/downloads',config.source.directory,'lib/VM/JSLib/GlobalObject.cpp');
const gcSource=await readFile(gcSourceFile,'utf8');
assert.match(gcSource,/CallResult<HermesValue> gc\(void \*, Runtime &runtime\) \{\s*runtime.collect\("forced"\);\s*return HermesValue::encodeUndefinedValue\(\);/);
assert.match(gcSource,/if \(jsLibFlags.enableHermesInternal\) \{\s*\/\/ Define the 'gc' function\.\s*defineGlobalFunc\(Predefined::getSymbolID\(Predefined::gc\), gc, 0\);/);
assert.equal(proof.forcedCollections.untouchedNativeCalls,207);assert.equal(proof.forcedCollections.candidateNativeCalls,207);

const contract=proof.source,original=(await readFile(resolve(root,contract.source),'utf8')).slice(contract.start,contract.end);assert.equal(sha(original),contract.sha256);
const extra=`
checks=[
 ['missing-set',function(f){delete f.skill.info.SetSpeeder}],
 ['missing-boss',function(f){delete f.config.is_boss}],
 ['missing-lock',function(f){delete f.skill.lockActionSpeeder}],
 ['missing-frozen',function(f){delete f.fx.frozen}],
 ['missing-motionless',function(f){delete f.fx.motionless}],
 ['missing-both-effects',function(f){delete f.fx.frozen;delete f.fx.motionless}],
 ['missing-current-skill',function(f){delete f.u.current_skill;f.u.state=0}],
 ['undefined-current-skill',function(f){f.u.current_skill=undefined;f.u.state=0}],
 ['false-current-skill',function(f){f.u.current_skill=false;f.u.state=0}],
 ['zero-current-skill',function(f){f.u.current_skill=-0;f.u.state=0}],
 ['missing-basic',function(f){delete f.u.basic_skill}],
 ['unused-missing-haste',function(f){f.u.basic_skill={};delete f.attrs.ATKHAST}],
 ['prototype-set',function(f){delete f.skill.info.SetSpeeder;Object.setPrototypeOf(f.skill.info,{SetSpeeder:25})}],
 ['prototype-lock',function(f){delete f.skill.lockActionSpeeder;Object.setPrototypeOf(f.skill,{lockActionSpeeder:true})}],
 ['prototype-getter-throws',function(f){delete f.skill.info.SetSpeeder;Object.setPrototypeOf(f.skill.info,Object.defineProperty({},'SetSpeeder',{get:function(){events.push(['proto-get']);throw sourceSentinel}}))}],
 ['deep-prototype-fallback',function(f){delete f.skill.lockActionSpeeder;var p={lockActionSpeeder:true};for(var k=0;k<35;k++)p=Object.create(p);Object.setPrototypeOf(f.skill,p)}],
 ['alias-info-unit',function(f){f.u.SetSpeeder=-20;f.skill.info=f.u}],
 ['alias-config-effects',function(f){f.u.config=f.fx;f.fx.is_boss=true}],
 ['null-prototype-inputs',function(f){Object.setPrototypeOf(f.attrs,null);Object.setPrototypeOf(f.fx,null);Object.setPrototypeOf(f.config,null);Object.setPrototypeOf(f.skill.info,null)}]
];
`;
let script=unitSpeederProbeSource(original).replace('i<20000','i<0').replace('for(var j=0;j<checks.length;j++)',extra+'for(var j=0;j<checks.length;j++)');
const js=resolve(dir,'probe.js'),cfile=resolve(dir,'original.c'),pools=resolve(dir,'pools');await mkdir(pools,{recursive:true});await writeFile(js,script);
function run(cmd,args,env=process.env){const r=spawnSync(cmd,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(r.status,0,r.stderr);return r;}
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes');assert.equal(sha(await readFile(compiler)),proof.compilerSha256);
run(compiler,['-O','-emit-c',js,'-o',cfile],{...process.env,SHERMES_BINARY_STRING_DIR:pools});
const c=await readFile(cfile,'utf8'),ascii=await readFile(resolve(pools,'s_ascii_pool.bin')),entries=await readFile(resolve(pools,'s_strings.bin'));
const string=i=>{const off=entries.readUInt32LE(i*12),len=entries.readUInt32LE(i*12+4);return off&0x80000000?null:ascii.subarray(off,off+len).toString('utf8')};
const table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(c),indices=[];table[1].trim().split('\n').forEach((row,i)=>{const id=Number(/source_index_plus_one = (\d+)/.exec(row)[1]);if(id&&string(id-1)===original)indices.push(i)});assert.equal(indices.length,1);
const symbol=new RegExp('static SHLegacyValue (_'+indices[0]+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\)').exec(c)[1],liveness=analyzeUnitSpeederLiveness(c,symbol),patch=await patchUnitSpeederC(c,pools,original,{liveness});
const patched=resolve(dir,'patched.c');
const candidateC=patch.source.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_review_main(int argc,char **argv) {')+'\n#include <stdio.h>\nint main(int argc,char **argv){int result=simx_review_main(argc,argv);fprintf(stderr,"review_speeder_hits:%zu\\n",simx_unit_speeder_hit_count());return result;}\n';
assert.notEqual(candidateC,patch.source);await writeFile(patched,candidateC);
function args(base,input,output){return base.map((arg,i)=>i===0?input:i===base.length-1?output:arg)}
const originalBin=resolve(dir,'original'),candidateBin=resolve(dir,'candidate');run('cc',args(proof.baselineArgs,cfile,originalBin));run('cc',args(proof.compileArgs,patched,candidateBin));
let source;const realm=createContext(constants.DONT_CONTEXTIFY);realm.print=x=>source=JSON.parse(x);realm.gc_=()=>{};runInContext(script,realm);
const baseline=JSON.parse(run(originalBin,['-Xhermes-internal-test-methods']).stdout),candidateRun=run(candidateBin,['-Xhermes-internal-test-methods'],{...process.env,LD_LIBRARY_PATH:resolve(build.privateVM.output,'..')}),candidate=JSON.parse(candidateRun.stdout);
const admitted=Number(/review_speeder_hits:(\d+)/.exec(candidateRun.stderr)?.[1]);assert.ok(admitted>0&&admitted<19);
assert.deepEqual(baseline,source);assert.deepEqual(candidate,source);
const bindings=[];for(const file of [proofFile,'tools/review-native-unit-speeder.mjs','tools/native-compiler-patches/unit-speeder-host.inc','tools/native-unit-speeder-patch.mjs','tools/native-unit-speeder.rs','crates/battle-core/src/unit_speeder.rs','tools/audit-unit-speeder-liveness.mjs'])bindings.push({file,sha256:sha(await readFile(resolve(root,file)))});
assert.equal(sha(await readFile(resolve(root,proofFile))),sha(proofBytes),'Base proof changed during review');
const outputBytes=Buffer.from(JSON.stringify({source,baseline,candidate})),outputGzip=gzipSync(outputBytes),outputFile='benchmarks/validation/native-unit-speeder-independent-review.outputs.json.gz';
await writeFile(resolve(root,outputFile),outputGzip);
const result={version:1,passed:true,scope:'Independent source and guard review plus 19 additional actual source/untouched-native/patched-native directed whole-continuation cases. No repeat of the 20k corpus and no full-battle or throughput claim.',baseProof:{file:proofFile,sha256:sha(proofBytes)},directedCases:source.rows.length,admitted,fallbackCases:source.rows.length-admitted,labels:source.rows.map(row=>row.label),sourceMatched:true,untouchedNativeMatched:true,patchedNativeMatched:true,checks:{currentPrototypeChainValidated:true,missingFieldsRequireNullTermination:true,ordinaryDataReadsOnly:true,rejectionBeforeWrites:true,sourceStoreOrderPreserved:true,continuationRestores:['np2:+0','np3:100','np9:action_dt'],deadRegisteredRootCleanup:'t3,t4,t5 always after success; t6 only for truthy object current_skill; rejected paths unchanged'},baseNativeForcedCollections:{untouched:207,candidate:207,implementation:'global gc calls runtime.collect("forced") when HermesInternal is enabled',sourceMirror:'207 no-op calls; not V8 collections',sourceFile:gcSourceFile,sourceSha256:sha(gcSource)},gcStressNotClaimedByThisReview:true,fullProgramEquivalence:false,qualifiesFor10000Target:false,scriptSha256:sha(script),generatedCSha256:sha(c),patchedCSha256:sha(candidateC),outputs:{file:outputFile,sha256:sha(outputGzip),uncompressedSha256:sha(outputBytes),uncompressedBytes:outputBytes.length},bindings};
await writeFile(resolve(root,'benchmarks/validation/native-unit-speeder-independent-review.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,cases:source.rows.length}));
