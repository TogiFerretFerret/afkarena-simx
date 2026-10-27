import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {bits} from './rng-trace.mjs';
const root=resolve(import.meta.dirname,'..');
if(!process.argv[2])throw new Error('Usage: node tools/precompute-config-differential.mjs RUNNER');
const sourceFile='src/srcmodule/game_battle.js',source=await readFile(resolve(root,sourceFile),'utf8');
const body=source.slice(154650,155568);
assert.equal(createHash('sha256').update(body).digest('hex'),'eab447a495ec54e60eccfdad4081d7a6038ff2169a9f05fea43d34cd5723c2d5','Stale original attribute-kernel coordinates');
const attributeNames=JSON.parse(/ed\.attrib_names=(\[[^;]+?\]),ed\.attrib_names_hash=/.exec(source)[1]);
assert.equal(attributeNames.length,47);
const nativeSource=await readFile(resolve(root,'crates/battle-core/src/config.rs'),'utf8');
assert.deepEqual(JSON.parse(`[${/ATTRIBUTE_NAMES:[^=]+=\s*\[([\s\S]*?)\];/.exec(nativeSource)[1]}]`),attributeNames,'Native attribute indexes differ from the original source order');
const groupKeys=['FIXED_ATTRIBS','BASE_COEFS','BASE_ADD','INNER_COEFS','ADDITION_ATTRIBS','OUTER_COEFS','OUTER_ADDS','SYS_OUTER_COEFS','SYS_OUTER_ADDS','FINAL_MULTIPLIER'];
const groupNames=['fixed_attribs','base_coefs','base_add','inner_coefs','addition_attribs','outer_coefs','outer_adds','sys_outer_coefs','sys_outer_adds','final_multiplier'];
const ui=await readFile(resolve(root,'src/srcmodule/game_ui_1.js'),'utf8');
const compareBody=ui.slice(4490466,4490673),compare=runInNewContext(`(${compareBody})`,{cc:{error:message=>{throw new Error(message)}}});
const calculate=runInNewContext(`(${body})`,{ed:{attrib_names:attributeNames,GET_UNIT_ATTR_TYPE:Object.fromEntries(groupKeys.map((k,i)=>[k,groupNames[i]])),compareFloat:compare}});
let state=0x9e3779b9;
function next(n){state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%n;}
const special=[0,-0,NaN,1,-1,95,95.00001,95.0001,100,1e16,-1e16,1e-16,Number.MIN_VALUE];
const cases=[];
for(let i=0;i<20000;i++){
 const groups=Array.from({length:10},(_,g)=>Array.from({length:next(4)},()=>{
   const entries=[];
   for(let j=0,count=1+next(5);j<count;j++){
     const attribute=next(47);
     let value=i<128?special[next(special.length)]:(next(2000001)-1000000)/(g===0||g===4||g===6||g===8?1:10000);
     entries.push([attribute,value]);
   }
   return entries;
 }));
 // Preserve duplicate sparse-property writes exactly: later values overwrite earlier ones.
 cases.push({trace:i<128,groups});
}
// Directed immunity boundary and summation-order cases are part of the same corpus.
cases[0]={trace:true,groups:[[[[0,1e16],[15,95.00001],[16,95.0001]],[[0,-1e16]],[[0,1]]],...Array.from({length:9},()=>[])]};
function serialize(c){return[+c.trace,...c.groups.flatMap(group=>[group.length,...group.flatMap(entries=>[entries.length,...entries.flatMap(([attribute,value])=>[attribute,bits(value)])])])].join(' ');}
const result=spawnSync(resolve(process.argv[2]),[],{input:cases.map(serialize).join('\n')+'\n',encoding:'utf8',maxBuffer:64*1024*1024});
if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);
const lines=result.stdout.trim().split('\n');assert.equal(lines.length,cases.length);
let formulaEvents=0;
for(let i=0;i<cases.length;i++){
 const input=Object.fromEntries(groupNames.map((name,g)=>[name,cases[i].groups[g].map(entries=>Object.fromEntries(entries.map(([a,v])=>[attributeNames[a],v])))]));
 const formulas=[];let finished=null;
 const observer=cases[i].trace?{recordFormula(name,formula,value){formulas.push({attribute:attributeNames.indexOf(name),terms:['fixed','baseCoef','baseAdd','innerCoef','addition','outerCoef','outerAdd','sysOuterCoef','sysOuterAdd','finalMultiplier'].map(key=>bits(formula[key])),value:bits(value)});},finishStatic(values){finished=attributeNames.map(name=>bits(values[name]));}}:undefined;
 const values=calculate(input,observer);
 const expected={values:attributeNames.map(name=>bits(values[name])),formulas,finished};
 const actual=JSON.parse(lines[i]);
 try{assert.deepEqual(actual,expected);}catch(error){await mkdir(resolve(root,'work'),{recursive:true});await writeFile(resolve(root,'work/precompute-first-divergence.json'),JSON.stringify({case:i,input:serialize(cases[i]),expected,actual},null,2)+'\n');throw new Error(`Attribute initialization diverged in case${i}: ${error.message.slice(0,300)}`);}
 formulaEvents+=formulas.length;
}
const summary={version:1,sourceName:'ed.unitAttribsManagerObj._finalCalculateAttribs',source:sourceFile,start:154650,end:155568,sourceSha256:createHash('sha256').update(body).digest('hex'),referenceRuntime:process.version,cases:cases.length,outputs:cases.length*47,formulaCallbackEvents:formulaEvents,finishStaticCallbackEvents:cases.filter(c=>c.trace).length,rawBitsExact:true,scope:'Dense immutable attribute initialization; input rows plain Number properties, finite arithmetic; falsy NaN/-0 contributions and source trace callbacks retained; not full battles'};
await mkdir(resolve(root,'work'),{recursive:true});await writeFile(resolve(root,'work/precompute-config-summary.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
