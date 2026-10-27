import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve,relative } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..'),work=resolve(root,'work/mutable-table-capsule-native');await mkdir(work,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex'),compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),compilerHash=hash(await readFile(compiler));
const files=['tools/battle-trace-portable.js','tools/qualification-mutable-table-capsule.js','tools/qualification-table-merkle-reference.js'];
const parts=await Promise.all(files.map(file=>readFile(resolve(root,file),'utf8'))),battle=await readFile(resolve(root,'src/srcmodule/game_battle.js'),'utf8');
const start=battle.indexOf('resetSkillList:function(')+'resetSkillList:'.length,end=battle.indexOf(',isHero:function',start),reset=battle.slice(start,end);
const script=parts.join('\n')+`\nif(typeof print!=='function')globalThis.print=function(value){console.log(value)};
function check(condition,message){if(!condition)throw Error(message)}
var capsule=installQualificationMutableTableCapsule({digest:portableTraceSha256});
var raw={row:{BasicSlot:0,SlotList:['0','1','2','3','4','']}},normal={row:{BasicSlot:0,SlotList:['0','1','2','3','4','']}},table=capsule.wrap(raw,{name:'UnitPeriod'});
function unit(){var u={log:[],skill_list:[],rebuild:function(){this.log.push('rebuild')}};for(var i=0;i<5;i++)(function(slot){u.skill_list.push({info:{Slot:slot,MaxRange:100},pause:function(){u.log.push('pause:'+slot)},resume:function(){u.log.push('resume:'+slot)}})})(i);return u;}
var resetSkillList=(${reset}),a=unit(),b=unit(),history=[];
for(var i=0;i<1000;i++){
 resetSkillList.call(a,normal.row);resetSkillList.call(b,table.row);
 check(qualificationTableFullHash(raw,portableTraceSha256)===qualificationTableFullHash(normal,portableTraceSha256),'source storage history differs');
 check(capsule.immutableMetadata(table).sha256===qualificationTableFullHash(raw,portableTraceSha256),'incremental hash differs');
 if(i<3||i===999)history.push(capsule.immutableMetadata(table).sha256);
}
check(JSON.stringify(a.log)===JSON.stringify(b.log)&&a.attack_range===b.attack_range&&a.basic_skill.info.Slot===b.basic_skill.info.Slot,'source control flow differs');
var frameRaw={'Mag.cha':{atk:{'0.5':{Cha:'Mag.cha',Action:'atk',Time:0.5,X:1,Y:2}}}},frame=capsule.wrap(frameRaw,{name:'AnimAtkFrame'});
frame['Mag.cha'].atk['0.5'].Type='Attack';check(capsule.immutableMetadata(frame).sha256===qualificationTableFullHash(frameRaw,portableTraceSha256),'Type addition hash differs');
var shared={x:1},aliasRaw={left:{shared:shared},right:{shared:shared},untouched:{x:2}},alias=capsule.wrap(aliasRaw,{name:'Aliased'}),leaf=alias.left.shared;
var before=capsule.stats().hashNodeRecomputes;leaf.x=-0;var aliasHash=capsule.immutableMetadata(alias).sha256;check(aliasHash===qualificationTableFullHash(aliasRaw,portableTraceSha256),'alias hash differs');var dirtyHashes=capsule.stats().hashNodeRecomputes-before;
var stored=[];for(var index=0;index<3;index++){table.row.SlotList[0]=index===0?Infinity:index===1?-Infinity:-0;check(capsule.immutableMetadata(table).sha256===qualificationTableFullHash(raw,portableTraceSha256),'special scalar hash differs');stored.push(capsule.immutableMetadata(table).sha256);}
var capture=installGraphCapture({immutableReference:function(value){return capsule.immutableMetadata(value)}}),graph=capture.snapshot({root:table,child:table.row.SlotList,alias:table.row.SlotList,frame:frame});
var mutations=[function(t){t.x={bad:1}},function(t){t.array[1]=2},function(t){t.array.length=0},function(t){delete t.x},function(t){Object.defineProperty(t,'x',{value:2})},function(t){Object.setPrototypeOf(t,Object.prototype)},function(t){Object.preventExtensions(t)},function(t){Reflect.set(t,'x',2,{})}],denied=[];
for(var n=0;n<mutations.length;n++){var m=installQualificationMutableTableCapsule({digest:portableTraceSha256}),target=m.parse('{"x":1,"array":[1]}',{name:'Denied'}),threw=false,sticky=false;try{mutations[n](target)}catch(e){threw=!!e.tableMembraneFailure}try{m.assertClean()}catch(e){sticky=!!e.tableMembraneFailure}denied.push([threw,sticky,JSON.stringify(target)]);}
print(JSON.stringify({history:history,stored:stored,sourceLogHash:portableTraceSha256(JSON.stringify(a.log)),sourceState:[a.attack_range,a.basic_skill.info.Slot],frameKeys:Object.keys(frame['Mag.cha'].atk['0.5']),frameHash:capsule.immutableMetadata(frame).sha256,alias:leaf===alias.right.shared&&leaf===Object.getOwnPropertyDescriptor(alias.left,'shared').value,dirtyHashes:dirtyHashes,graph:graph,denied:denied,stats:capsule.stats(),clean:capsule.assertClean()}));\n`;
const sourcePath=resolve(work,'probe.js'),binary=resolve(work,'probe');await writeFile(sourcePath,script);
function run(command,args){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',env:{...process.env,NODE_OPTIONS:''},maxBuffer:16*1024*1024});if(result.error)throw result.error;if(result.status!==0)throw Error(`${command} failed ${result.status}: ${result.stderr}`);return result.stdout;}
const reference=run(process.execPath,['--jitless',sourcePath]),flags=['-O','-Wc,-O1,-g0,-ffp-contract=off'];run(compiler,[...flags,sourcePath,'-o',binary]);const candidate=run(binary,[]);
assert.equal(hash(await readFile(compiler)),compilerHash,'Compiler changed during probe');
await writeFile(sourcePath+'.reference.json',reference);await writeFile(sourcePath+'.candidate.json',candidate);
const passed=reference===candidate,report={version:1,passed,qualifiesForThroughputTarget:false,sourceFiles:Object.fromEntries(files.map((file,i)=>[file,hash(parts[i])])),sourceResetSkillList:{file:'src/srcmodule/game_battle.js',start,end,sha256:hash(reset)},scriptSha256:hash(script),reference:{node:process.version,flags:['--jitless'],sha256:hash(reference)},candidate:{compiler:relative(root,compiler),compilerSha256:compilerHash,flags,sha256:hash(candidate)},checks:['1000 original Unit.resetSkillList histories raw versus canonical proxy, including empty string to positive canonical NaN actual array storage','Every history incremental digest versus independent uncached full raw descriptor graph','AnimAtkFrame absent Type addition order and descriptors','Diamond alias dirty-ancestor rehash count, detached external leaf alias and descriptor identity','Infinity, negative Infinity and negative zero stored-bit hashes','All unsupported mutation classes throw before changing target and remain sticky','Current dynamic table hash in registered exporter leaves'],limitations:['Isolated compiled capsule probe, no completed battle corpus qualification','Other NaN sign/payloads are rejected by the source capsule before writes; candidate compiler has separate known payload transport limitations','Raw decoded table ownership must remain private to the loader; direct wrap cannot revoke existing host aliases']};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});await writeFile(resolve(root,'benchmarks/validation/mutable-table-capsule-native.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!passed)process.exitCode=2;
