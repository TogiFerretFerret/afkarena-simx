import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve,relative } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..'),outputDir=resolve(root,'work/table-membrane-native-probe');
await mkdir(outputDir,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),compilerHash=hash(await readFile(compiler));
const sources=await Promise.all(['tools/battle-trace-portable.js','tools/qualification-table-membrane.js'].map(file=>readFile(resolve(root,file),'utf8')));
const script=sources.join('\n')+`\nif(typeof print!=='function')globalThis.print=function(value){console.log(value)};
var membrane=installQualificationTableMembrane({digest:portableTraceSha256});
var table=membrane.parse('{"unit":{"hp":-0,"skills":[1,{"v":2}]},"enemies":[3,4]}',{name:'Fixture'});
var capture=installGraphCapture({immutableReference:function(value){return membrane.immutableMetadata(value)}});
var desc=Object.getOwnPropertyDescriptor(table,'unit');
function clone(e){var t=e.constructor?new e.constructor:{};for(var keys=Object.keys(e),i=0;i<keys.length;i++){var k=keys[i],v=e[k];t[k]=typeof v==='object'&&v?clone(v):v;}return t;}
var copy=clone(table);copy.unit.skills[1].v=7;
var result={metadata:membrane.immutableMetadata(table),child:membrane.immutableMetadata(table.unit),graph:capture.snapshot({table:table,child:table.unit,alias:desc.value}),
 reads:{alias:table.unit===desc.value,array:Array.isArray(table.unit.skills),instance:table.unit.skills instanceof Array,constructor:table.constructor===Object&&table.unit.skills.constructor===Array,proto:Object.getPrototypeOf(table)===Object.prototype,toString:Object.prototype.toString.call(table.unit.skills),negativeZero:1/table.unit.hp===-Infinity,copy:copy.unit.skills[1].v===7&&table.unit.skills[1].v===2,json:JSON.stringify(table)}};
var operations=[function(t){t.fresh={x:1}},function(t){Object.defineProperty(t,'unit',{value:{}})},function(t){delete t.unit},function(t){Object.setPrototypeOf(t,Object.prototype)},function(t){Object.preventExtensions(t)},function(t){Object.getOwnPropertyDescriptor(t,'unit').value.skills.push(8)}];
result.writes=[];
for(var i=0;i<operations.length;i++){var m=installQualificationTableMembrane({digest:portableTraceSha256}),t=m.parse('{"unit":{"skills":[1]}}',{name:'Mutation'}),threw=false,sticky=false;
 try{operations[i](t)}catch(e){threw=!!e.tableMembraneFailure}try{m.assertClean()}catch(e){sticky=!!e.tableMembraneFailure}
 result.writes.push({threw:threw,sticky:sticky,stats:m.stats(),unchanged:JSON.stringify(t)==='{"unit":{"skills":[1]}}'});}
result.clean=membrane.assertClean();print(JSON.stringify(result));\n`;
const path=resolve(outputDir,'probe.js'),binary=resolve(outputDir,'probe');await writeFile(path,script);
function run(command,args){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''},maxBuffer:16*1024*1024});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} failed ${result.status}: ${result.stderr}`);return result.stdout;}
const reference=run(process.execPath,['--jitless',path]);
const flags=['-O','-Wc,-O1,-g0,-ffp-contract=off'];run(compiler,[...flags,path,'-o',binary]);const candidate=run(binary,[]);
assert.equal(hash(await readFile(compiler)),compilerHash,'Compiler changed during probe');
const passed=reference===candidate;
await writeFile(path+'.reference.json',reference);await writeFile(path+'.candidate.json',candidate);
const report={version:1,passed,qualifiesForThroughputTarget:false,reference:{node:process.version,flags:['--jitless'],sha256:hash(reference)},candidate:{compiler:relative(root,compiler),compilerSha256:compilerHash,flags,sha256:hash(candidate)},sourceSha256:hash(script),membraneSha256:hash(sources[1]),checks:['source JSON clone independence','standard array/prototype/constructor/descriptor reads','canonical immutable table metadata and exporter leaf alias identity','all five mutation traps plus nested array mutation throw before change and remain sticky'],limitations:['Isolated actual compiled membrane/exporter probe; no battle source table purity or complete battle fidelity qualification','NaN inputs omitted because the compiler has separate known strict NaN sign/payload failures']};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});await writeFile(resolve(root,'benchmarks/validation/table-membrane-native.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!passed)process.exitCode=2;
