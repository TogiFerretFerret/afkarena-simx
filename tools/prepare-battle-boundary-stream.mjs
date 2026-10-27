import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import assert from 'node:assert/strict';
import {emitBattleBoundaryNDJSON} from './battle-boundary-ndjson.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/battle-boundary-trace'),sha=b=>createHash('sha256').update(b).digest('hex'),hash=async file=>sha(await readFile(resolve(root,file)));
const baseFile=resolve(directory,'native-fast-build.json'),base=JSON.parse(await readFile(baseFile));assert.equal(base.passed,true);
const dependencies=[{file:baseFile,sha256:await hash(baseFile)},...base.dependenciesAtFinish,{file:base.helper.file,sha256:base.helper.sha256},{file:base.privateVM.output,sha256:base.privateVM.privateSha256},{file:base.compiler.file,sha256:base.compiler.sha256}];
for(const unit of base.units)dependencies.push({file:unit.file,sha256:unit.sourceSha256??unit.sha256},{file:unit.object,sha256:unit.objectSha256});
for(const file of ['tools/prepare-battle-boundary-stream.mjs','tools/battle-boundary-ndjson.mjs'])dependencies.push({file,sha256:await hash(file)});
for(const row of dependencies)assert.equal(await hash(row.file),row.sha256,'Stale stream build input '+row.file);
const old=await readFile(base.units[6].file,'utf8'),needle='print(JSON.stringify(__nativeResult));';assert.equal(old.split(needle).length,2);
const serializer=emitBattleBoundaryNDJSON.toString();assert.ok((await readFile(resolve(root,'tools/battle-boundary-ndjson.mjs'),'utf8')).includes(serializer));
const replacement='('+serializer+')(__nativeResult,print);',source=old.replace(needle,replacement),file=resolve(directory,'runner.stream.js'),object=resolve(directory,'runner.stream.o');await writeFile(file,source);
async function run(command,args,label){const out=openSync(resolve(directory,label+'.stdout'),'w'),err=openSync(resolve(directory,label+'.stderr'),'w');try{return await new Promise((accept,reject)=>{const child=spawn(command,args,{cwd:root,stdio:['ignore',out,err]});child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});}finally{closeSync(out);closeSync(err);}}
const compileArgs=['-O','-c','-exported-unit=runner','-Wc,-O1,-g0,-ffp-contract=off',file,'-o',object];assert.equal((await run(base.compiler.file,compileArgs,'stream-compile')).code,0,await readFile(resolve(directory,'stream-compile.stderr'),'utf8'));
const units=base.units.map((u,i)=>i===6?{...u,file,sha256:sha(source),sourceSha256:sha(source),object,objectSha256:null}:u);units[6].objectSha256=await hash(object);
const output=resolve(directory,'native-stream'),linkArgs=base.linkArgs.map(arg=>arg===base.units[6].object?object:arg===base.output?output:arg);assert.ok(linkArgs.includes(object));assert.equal(linkArgs.at(-1),output);
assert.equal((await run('cc',linkArgs,'stream-link')).code,0,await readFile(resolve(directory,'stream-link.stderr'),'utf8'));
const dependenciesAtFinish=[];for(const row of dependencies){const actual=await hash(row.file);dependenciesAtFinish.push({...row,matched:actual===row.sha256});assert.equal(actual,row.sha256,'Stream build input changed '+row.file);}
const proof={...base,scope:'BUILD ONLY optimized native boundary trace with bounded post-battle NDJSON export. Only the terminal print expression changes; all game/tracing functions and six actual optimized objects are reused. No game-state mutation, discarded event or snapshot, or trace semantic change.',units,output,outputSha256:await hash(output),linkArgs,dependenciesAtFinish,baseOptimizedBuild:{file:baseFile,sha256:await hash(baseFile)},serializer:{file:'tools/battle-boundary-ndjson.mjs',sha256:await hash('tools/battle-boundary-ndjson.mjs'),functionSha256:sha(serializer),utf16CodeUnitLimitPerRow:16*1024*1024,oldPrint:needle,replacementSha256:sha(replacement)},streamCompilation:{file,sourceSha256:sha(source),compileArgs,object,objectSha256:await hash(object)},producer:{file:'tools/prepare-battle-boundary-stream.mjs',sha256:await hash('tools/prepare-battle-boundary-stream.mjs')}};
await writeFile(resolve(directory,'native-stream-build.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,output,outputSha256:proof.outputSha256}));
