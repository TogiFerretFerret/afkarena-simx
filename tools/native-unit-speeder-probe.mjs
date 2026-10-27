import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import {gzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {unitSpeederProbeSource} from './native-unit-speeder-cases.mjs';
import {patchUnitSpeederC} from './native-unit-speeder-patch.mjs';
import {analyzeUnitSpeederLiveness} from './audit-unit-speeder-liveness.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-unit-speeder-probe'),sha=b=>createHash('sha256').update(b).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(profile.rawBitReferenceFlags)){const child=spawnSync(process.execPath,[...profile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(child.status??1);}
await mkdir(directory,{recursive:true});
function run(command,args,env=process.env){const r=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:256*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r;}
const buildFile='benchmarks/validation/native-unit-speeder-build.json',buildBytes=await readFile(resolve(root,buildFile)),base=JSON.parse(buildBytes);
assert.equal(base.passed,true);
for(const [file,expected]of Object.entries(base.sources))assert.equal(sha(await readFile(resolve(root,file))),expected,'Stale build '+file);
assert.equal(sha(await readFile(base.privateVM.output)),base.privateVM.privateSha256);
const contract=JSON.parse(await readFile(resolve(root,'config/unit-translation.json'))),original=(await readFile(resolve(root,contract.source),'utf8')).slice(contract.start,contract.end);assert.equal(sha(original),contract.sha256);
const script=unitSpeederProbeSource(original),js=resolve(directory,'probe.js');await writeFile(js,script);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),checkout=resolve(root,'work/downloads',config.source.directory),build=resolve(root,'work/downloads/hermes-build'),compiler=resolve(build,'bin/shermes'),pools=resolve(directory,'pools');await mkdir(pools,{recursive:true});
const originalC=resolve(directory,'original.c');run(compiler,['-O','-emit-c',js,'-o',originalC],{...process.env,SHERMES_BINARY_STRING_DIR:pools});
const c=await readFile(originalC,'utf8'),ascii=await readFile(resolve(pools,'s_ascii_pool.bin')),entries=await readFile(resolve(pools,'s_strings.bin'));
const string=id=>{const p=entries.readUInt32LE(id*12),n=entries.readUInt32LE(id*12+4);return p&0x80000000?null:ascii.subarray(p,p+n).toString('utf8')};
const table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(c);assert.ok(table);const indices=[];table[1].trim().split('\n').forEach((row,index)=>{const id=Number(/source_index_plus_one = (\d+)/.exec(row)[1]);if(id&&string(id-1)===original)indices.push(index)});assert.equal(indices.length,1);
const symbol=new RegExp('static SHLegacyValue (_'+indices[0]+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\)').exec(c)[1];
const liveness=analyzeUnitSpeederLiveness(c,symbol);await writeFile(resolve(directory,'liveness.json'),JSON.stringify(liveness,null,2)+'\n');
const patch=await patchUnitSpeederC(c,pools,original,{liveness});
let patched=patch.source.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_original_main(int argc,char **argv) {');assert.notEqual(patched,patch.source);
patched+='\n#include <stdio.h>\nint main(int argc,char **argv){int result=simx_original_main(argc,argv);fprintf(stderr,"unit_speeder_hits:%zu\\n",simx_unit_speeder_hit_count());return result;}\n';
const patchedC=resolve(directory,'patched.c');await writeFile(patchedC,patched);
function compile(input,output,extra,privateVM){const paths=privateVM?[resolve(base.privateVM.output,'..')]:[];const args=[input,...extra,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(checkout,'include')];for(const p of [...paths,resolve(build,'lib'),resolve(build,'jsi'),resolve(build,'tools/shermes')])args.push('-L'+p,'-Wl,-rpath,'+p);args.push('-lshermes_console','-lhermesvm','-lstdc++','-ldl','-lpthread','-lm','-o',output);run('cc',args);return args;}
const originalBinary=resolve(directory,'original'),binary=resolve(directory,'candidate');const baselineArgs=compile(originalC,originalBinary,[],false),compileArgs=compile(patchedC,binary,[base.libraries.unitSpeeder.path],true);
function firstDifference(a,b,path='$'){
 if(Object.is(a,b))return null;
 if(typeof a!==typeof b||a===null||b===null||typeof a!=='object')return{path,expected:a,actual:b};
 const ak=Object.keys(a),bk=Object.keys(b);
 if(ak.length!==bk.length)return{path:path+'.keys',expected:ak,actual:bk};
 for(let i=0;i<ak.length;i++){if(ak[i]!==bk[i])return{path:path+'.keys['+i+']',expected:ak[i],actual:bk[i]};const d=firstDifference(a[ak[i]],b[bk[i]],path+'.'+ak[i]);if(d)return d;}return null;
}
async function requireEqual(actual,expected,stage){
 const difference=firstDifference(expected,actual);if(!difference)return;
 const rowIndex=Number(/^\$\.rows\.(\d+)/.exec(difference.path)?.[1]);
 const failure={version:1,passed:false,stage,difference,case:Number.isFinite(rowIndex)?{expected:expected.rows[rowIndex],actual:actual.rows[rowIndex]}:null};
 await writeFile(resolve(root,'benchmarks/validation/native-unit-speeder-failure.json'),JSON.stringify(failure,null,2)+'\n');
 throw Error(stage+': '+JSON.stringify(difference));
}
let expected;const realm=createContext(constants.DONT_CONTEXTIFY);realm.print=x=>expected=JSON.parse(x);realm.gc=()=>{};runInContext(script,realm);
const baselineRun=run(originalBinary,['-Xhermes-internal-test-methods']),baseline=JSON.parse(baselineRun.stdout);await requireEqual(baseline,expected,'Untouched native vs pinned original source');
const candidateRun=run(binary,['-Xhermes-internal-test-methods'],{...process.env,LD_LIBRARY_PATH:resolve(base.privateVM.output,'..')}),actual=JSON.parse(candidateRun.stdout);
await requireEqual(actual,expected,'Actual interior splice vs original source');
const hits=Number(/unit_speeder_hits:(\d+)/.exec(candidateRun.stderr)?.[1]);assert.ok(hits>=19000,'Actual original Unit.update numeric block must run through Rust');
const archive='benchmarks/validation/native-unit-speeder.outputs.json.gz',bytes=Buffer.from(JSON.stringify({expected,baseline,actual,stderr:candidateRun.stderr}));await writeFile(resolve(root,archive),gzipSync(bytes));
const files=['tools/native-unit-speeder-probe.mjs','tools/native-unit-speeder-cases.mjs','tools/native-unit-speeder-patch.mjs','tools/audit-unit-speeder-liveness.mjs'];const sources={...base.sources};for(const file of files)sources[file]=sha(await readFile(resolve(root,file)));
for(const [file,expected]of Object.entries(sources))assert.equal(sha(await readFile(resolve(root,file))),expected);
const proof={version:1,passed:true,semanticProofPassed:true,integratedInBattle:false,qualifiesFor10000Target:false,scope:'Guarded numeric interior of original Unit.update compared through its full unchanged continuation against pinned jitless source and untouched native across 20,000 generated valid-state cases and 20 directed descriptor/getter/Proxy/alias/prefix cases. Every recorded continuation callback and selected numeric output matches raw f64 bits. This fixture gate does not establish universal Unit.update, full-battle, or throughput equivalence.',excludedNegative:{file:'benchmarks/validation/native-unit-speeder-invalid-phase-failure.json',sha256:sha(await readFile(resolve(root,'benchmarks/validation/native-unit-speeder-invalid-phase-failure.json'))),reason:'An invalid Attack state with null current_skill throws engine-specific TypeError messages in untouched Hermes versus V8. The exact mismatch is retained without normalization; generated null-skill cases use idle continuation. General cross-engine error-message equivalence is not claimed.'},errorCases:actual.rows.filter(row=>row.error).map(row=>({label:row.label,error:row.error})),source:contract,sourceCases:20000,directedCases:actual.rows.length-20000,hits,forcedCollections:{scheduled:Math.ceil(20000/97),sourceOracleCalls:expected.forcedCollections,untouchedNativeCalls:baseline.forcedCollections,candidateNativeCalls:actual.forcedCollections,mechanism:'Actual pinned StaticHermes console provides global gc; observed native call counts are recorded. Source realm mirrors calls with a no-op gc stub, so source count is not a V8 collection count. Legacy global gc_ is absent. Scheduled opportunities alone are not collection evidence.'},oracleProfile:profile,liveness:{functionSha256:liveness.generated.functionSha256,regionSha256:liveness.generated.regionSha256,continuationLive:liveness.analysis.continuationLive,restore:liveness.analysis.assignedAndLiveAtContinuation},privateVM:base.privateVM,sources,buildProof:{file:buildFile,sha256:sha(buildBytes)},scriptSha256:sha(script),originalCSha256:sha(c),patchedCSha256:sha(patched),compilerSha256:sha(await readFile(compiler)),binarySha256:sha(await readFile(binary)),compileArgs,baselineArgs,archive:{file:archive,sha256:sha(await readFile(resolve(root,archive))),uncompressedSha256:sha(bytes)},numericPolicy:'No NaN or counter normalization; exact raw Number bits. Guards reject before writes; source fallback continues from original block entry.'};
await writeFile(resolve(root,'benchmarks/validation/native-unit-speeder.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,hits,cases:actual.rows.length,continuationLive:proof.liveness.continuationLive}));
