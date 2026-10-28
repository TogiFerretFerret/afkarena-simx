import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),generator='tools/rust-port/generate-program.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tracked={};for(const file of [generator,'tools/rust-port/compile.mjs','tools/rust-port/check-gc-cadence-generator.mjs'])tracked[file]=sha(await readFile(resolve(root,file)));
const run=args=>spawnSync(process.execPath,[generator,...args],{cwd:root,encoding:'utf8',maxBuffer:1024*1024});
for(const value of ['0','-1','1.5','Infinity','9007199254740992']){const child=run(['--gc-cadence',value]);assert.notEqual(child.status,0);assert.match(child.stderr,/--gc-cadence must be a positive safe integer/);}
const output='work/cadence-generator-smoke',rows=[];
for(const [label,args,cadence]of [['four',['--gc-cadence','4'],4],['default',[],1]]){
 const command=['--through','0','--out',output,...args],child=run(command);assert.equal(child.status,0,child.stderr);
 const programFile=output+'/program-manifest.json',unitFile=output+'/battle-unit-0/manifest.json';
 const program=JSON.parse(await readFile(resolve(root,programFile))),unit=JSON.parse(await readFile(resolve(root,unitFile)));
 assert.equal(program.nativeBattleGcCadence,cadence);assert.equal(unit.nativeBattleGcCadence,cadence);assert.equal(program.nativeBattleGc,false);assert.equal(unit.unsupportedFunctions,0);
 rows.push({label,command:[process.execPath,generator,...command],cadence,functions:unit.functions.length,programManifestSha256:sha(await readFile(resolve(root,programFile))),unitManifestSha256:sha(await readFile(resolve(root,unitFile))),generatorSha256:program.sources[generator],compilerSha256:program.sources['tools/rust-port/compile.mjs']});
}
for(const[file,digest]of Object.entries(tracked))assert.equal(sha(await readFile(resolve(root,file))),digest);
const report={passed:true,scope:'CLI validation and actual frozen unit0 generation; full battle cadence behavior is qualified by the separate OFF/1/4 collector fixture.',invalidValuesRejected:5,sourceInputsUnchanged:tracked,rows};
await writeFile(resolve(root,'benchmarks/validation/rust-gc-cadence-generator.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,cadences:rows.map(r=>r.cadence),invalidValuesRejected:5}));
