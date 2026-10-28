import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
import {analyzeUnitSpeederLiveness} from './audit-unit-speeder-liveness.mjs';
import {patchUnitSpeederC} from './native-unit-speeder-patch.mjs';

// Default: preparation only. --build explicitly compiles and links, but neither
// mode changes the completed trace or executes a battle. This candidate was
// slower in its warmed fixture, so the preparation is retained without promotion.
assert.ok(process.argv.slice(2).every(arg=>arg==='--build'),'Only --build is supported');
const buildRequested=process.argv.includes('--build');
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-speeder');
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
await mkdir(directory,{recursive:true});
const baseFile='work/battle-boundary-trace/native-stream-build.json';
const battleFile='benchmarks/validation/native-unit-speeder-battle-build.json';
const semanticFile='benchmarks/validation/native-unit-speeder.json';
const base=JSON.parse(await readFile(resolve(root,baseFile))),battle=JSON.parse(await readFile(resolve(root,battleFile))),semantic=JSON.parse(await readFile(resolve(root,semanticFile)));
assert.equal(base.passed,true);assert.equal(battle.passed,true);assert.equal(semantic.passed,true);assert.equal(semantic.semanticProofPassed,true);
assert.equal(semantic.buildProof.sha256,battle.prerequisites.speeder.sha256);
const dependencies=new Map();
async function bind(file,expected){const actual=await hash(file);if(expected!==undefined)assert.equal(actual,expected,'Stale trace build input '+file);dependencies.set(file,actual);}
for(const file of [baseFile,battleFile,semanticFile,'tools/prepare-battle-boundary-speeder.mjs','tools/audit-unit-speeder-liveness.mjs','tools/native-unit-speeder-patch.mjs'])await bind(file);
for(const row of base.dependenciesAtFinish){assert.equal(row.matched,true);await bind(row.file,row.sha256);}
for(const [file,expected]of Object.entries({...battle.sources,...semantic.sources}))await bind(file,expected);
for(const unit of base.units){await bind(unit.file,unit.sourceSha256??unit.sha256);await bind(unit.object,unit.objectSha256);}
await bind(base.patchedC.file,base.patchedC.sha256);await bind(battle.privateVM.output,battle.privateVM.privateSha256);await bind(battle.wrapper.output,battle.wrapper.sha256);await bind(battle.helper.file,battle.helper.sha256);
for(const row of Object.values(battle.libraries))await bind(row.path,row.sha256);
const contractFile='config/unit-translation.json';await bind(contractFile);
const contract=JSON.parse(await readFile(resolve(root,contractFile))),source=await readFile(resolve(root,contract.source),'utf8'),original=source.slice(contract.start,contract.end);assert.equal(sha(original),contract.sha256);await bind(contract.source);
const pools=resolve(root,'work/battle-boundary-trace/fast-string-pools');
const ascii=await readFile(resolve(pools,'s_ascii_pool.bin')),strings=await readFile(resolve(pools,'s_strings.bin'));
for(const name of ['s_ascii_pool.bin','s_strings.bin'])await bind(resolve(pools,name));
const string=id=>{const offset=strings.readUInt32LE(id*12),length=strings.readUInt32LE(id*12+4);return offset&0x80000000?null:ascii.subarray(offset,offset+length).toString('utf8');};
const c=await readFile(base.patchedC.file,'utf8'),table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(c);assert.ok(table);
const indices=[];table[1].trim().split('\n').forEach((row,index)=>{const id=Number(/source_index_plus_one = (\d+)/.exec(row)[1]);if(id&&string(id-1)===original)indices.push(index);});assert.equal(indices.length,1);
const symbol=new RegExp('static SHLegacyValue (_'+indices[0]+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\)').exec(c)[1];
const liveness=analyzeUnitSpeederLiveness(c,symbol),livenessFile=resolve(root,'benchmarks/validation/battle-boundary-speeder-liveness.json');
await writeFile(livenessFile,JSON.stringify(liveness,null,2)+'\n');
const patch=await patchUnitSpeederC(c,pools,original,{liveness});
const cFile=resolve(directory,'partition_0.speeder.c'),object=resolve(directory,'partition_0.speeder.o');await writeFile(cFile,patch.source);
const ccArgs=base.ccArgs.map(arg=>arg===base.patchedC.file?cFile:arg===base.units[0].object?object:arg);assert.ok(ccArgs.includes(cFile)&&ccArgs.includes(object));
if(!buildRequested){
 const bindings=[];for(const [file,expected]of dependencies){const actual=await hash(file);assert.equal(actual,expected,'Preparation input changed '+file);bindings.push({file,sha256:expected});}
 const proof={version:1,passed:true,preparedOnly:true,compiled:false,executed:false,semanticReportMatched:null,qualifiesFor10000Target:false,scope:'Preparation only for an optional UnitSpeeder selected-state trace: source-bound numeric interior patch and fresh whole-function CFG liveness audit. No compilation, native battle, ordered trace comparison or performance evidence. The slower warmed candidate is not promoted.',base:{file:baseFile,sha256:await hash(baseFile)},battleBuild:{file:battleFile,sha256:await hash(battleFile)},semanticProof:{file:semanticFile,sha256:await hash(semanticFile)},liveness:{file:livenessFile,sha256:await hash(livenessFile),continuationLive:liveness.analysis.continuationLive,restore:liveness.analysis.assignedAndLiveAtContinuation},originalC:base.patchedC,preparedC:{file:cFile,sha256:sha(patch.source)},originalFunctionSha256:patch.originalFunctionSha256,regionSha256:patch.blockSha256,compileArgs:ccArgs,sixOtherObjectsReusedIfBuilt:true,bindings,producer:{file:'tools/prepare-battle-boundary-speeder.mjs',sha256:await hash('tools/prepare-battle-boundary-speeder.mjs')}};
 const file='benchmarks/validation/battle-boundary-speeder-preparation.json';await writeFile(resolve(root,file),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,preparedOnly:true,compiled:false,executed:false,file}));process.exit(0);
}
async function run(command,args,label){const out=openSync(resolve(directory,label+'.stdout'),'w'),err=openSync(resolve(directory,label+'.stderr'),'w');try{return await new Promise((accept,reject)=>{const child=spawn(command,args,{cwd:root,stdio:['ignore',out,err]});child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}}
assert.equal((await run('cc',ccArgs,'compile')).code,0,await readFile(resolve(directory,'compile.stderr'),'utf8'));
const oldMain=base.linkArgs[0];await bind(oldMain);
let main=await readFile(oldMain,'utf8');assert.equal(main.split('int main(').length,2);main=main.replace('int main(','extern size_t simx_unit_speeder_hit_count(void);\nint main(');
const needle='simx_global_slot_dump(shr);';assert.equal(main.split(needle).length,2);main=main.replace(needle,'fprintf(stderr,"unit_speeder_hits:%zu\\n",simx_unit_speeder_hit_count());'+needle);
const mainFile=resolve(directory,'main.c');await writeFile(mainFile,main);
const output=resolve(directory,'native-stream'),oldDirectory=dirname(base.privateVM.output),privateDirectory=dirname(battle.privateVM.output);
const linkArgs=base.linkArgs.map(arg=>arg===oldMain?mainFile:arg===base.units[0].object?object:arg===base.output?output:arg==='-L'+oldDirectory?'-L'+privateDirectory:arg==='-Wl,-rpath,'+oldDirectory?'-Wl,-rpath,'+privateDirectory:arg);
linkArgs.splice(linkArgs.indexOf('-O2'),0,battle.libraries.unitSpeeder.path);
assert.equal((await run('cc',linkArgs,'link')).code,0,await readFile(resolve(directory,'link.stderr'),'utf8'));
const dependenciesAtFinish=[];for(const [file,expected]of dependencies){const actual=await hash(file);dependenciesAtFinish.push({file,sha256:expected,matched:actual===expected});assert.equal(actual,expected,'Input changed during trace build '+file);}
const units=base.units.map((u,i)=>i===0?{...u,object,objectSha256:null}:u);units[0].objectSha256=await hash(object);
const proof={...base,scope:'BUILD ONLY new guarded Rust Unit.update numeric interior in the completed selected-state trace. Same source/helper/NDJSON and six other objects; original Entity/clone/Rust V8 sort/C-prefilter retained. Requires new actual execution and ordered-state comparison.',units,privateVM:battle.privateVM,wrapper:battle.wrapper,libraries:battle.libraries,originalC:{file:base.patchedC.file,sha256:base.patchedC.sha256},patchedC:{file:cFile,sha256:sha(patch.source)},ccArgs,linkArgs,output,outputSha256:await hash(output),main:{file:mainFile,sha256:sha(main)},speeder:{semanticProof:{file:semanticFile,sha256:await hash(semanticFile)},battleBuild:{file:battleFile,sha256:await hash(battleFile)},helper:battle.helper,liveness:{file:livenessFile,sha256:await hash(livenessFile)},functionSha256:patch.originalFunctionSha256,regionSha256:patch.blockSha256},dependenciesAtFinish,baseTraceBuild:{file:baseFile,sha256:await hash(baseFile)},producer:{file:'tools/prepare-battle-boundary-speeder.mjs',sha256:await hash('tools/prepare-battle-boundary-speeder.mjs')}};
const file='benchmarks/validation/battle-boundary-speeder-build.json';await writeFile(resolve(root,file),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,file,output}));
