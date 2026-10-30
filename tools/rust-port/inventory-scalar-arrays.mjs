// Analysis only: never changes a compiler allowlist, emits Rust or runs battles.
import fs from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from '@babel/parser';
import {planNativeLocals} from './bindings.mjs';
import {planScalarLocalArrays,scalarArraySourceHashes} from './scalar-array-inventory-planner.mjs';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),opt=(n,d)=>args.includes(n)?args[args.indexOf(n)+1]:d;
const root=resolve(opt('--root',process.cwd())),output=resolve(root,opt('--output','benchmarks/validation/scalar-array-opportunity-inventory.json'));
const sha=b=>createHash('sha256').update(b).digest('hex'),inputs={};
async function read(p){const b=await fs.readFile(p);inputs[p]=sha(b);return b;}
for(const p of [import.meta.filename,resolve(import.meta.dirname,'bindings.mjs'),resolve(import.meta.dirname,'scalar-array-inventory-planner.mjs')])await read(p);
const matrixPath=resolve(root,'benchmarks/validation/signed-camp-bottleneck-matrix.json'),matrix=JSON.parse(await read(matrixPath));assert.equal(matrix.passed,true);
const FN=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
const children=n=>Object.entries(n).flatMap(([k,v])=>['loc','extra','comments','tokens'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x&&typeof x.type==='string'):v&&typeof v.type==='string'?[v]:[]);
function names(p,out){if(!p)return;if(p.type==='Identifier')out.add(p.name);else if(p.type==='RestElement')names(p.argument,out);else if(p.type==='AssignmentPattern')names(p.left,out);else if(p.type==='ArrayPattern')p.elements.forEach(x=>names(x,out));else if(p.type==='ObjectPattern')p.properties.forEach(x=>names(x.type==='RestElement'?x.argument:x.value,out));}
const rows=[],units=[];let functions=0,arrays=0;
for(let unit=0;unit<7;unit++){
 const manifestPath=resolve(root,`work/rust-battle-full/battle-unit-${unit}/manifest.json`),manifestBytes=await read(manifestPath),m=JSON.parse(manifestBytes);assert.equal(sha(manifestBytes),matrix.sourceInputs[`work/rust-battle-full/battle-unit-${unit}/manifest.json`]);
 const source=String(await read(m.filename));assert.equal(sha(source),m.sourceSha256);
 const ast=parse(source,{sourceType:m.mode==='module'?'module':'script',allowReturnOutsideFunction:false}).program,parents=new WeakMap(),byRange=new Map();
 function collect(n,p){parents.set(n,p);if(FN.has(n.type)||n.type==='Program')byRange.set(n.start+':'+n.end,n);for(const c of children(n))collect(c,n);}collect(ast,null);
 let unitArrays=0,eligibleFunctions=0;
 for(const f of m.functions){functions++;const n=byRange.get(f.start+':'+f.end);assert.ok(n,'Missing manifest function '+unit+':'+f.id);const hash=sha(source.slice(n.start,n.end));assert.equal(hash,f.sourceSha256);const body=[];function own(x){body.push(x);if(x!==n&&FN.has(x.type))return;for(const c of children(x))own(c);}own(n);
 const sites=body.filter(x=>x.type==='ArrayExpression');arrays+=sites.length;unitArrays+=sites.length;if(!sites.length)continue;
 const hoisted=new Set();for(const x of body){if(x.type==='VariableDeclaration'&&x.kind==='var')x.declarations.forEach(d=>names(d.id,hoisted));if(x.type==='FunctionDeclaration'&&x!==n&&parents.get(x)===n.body)names(x.id,hoisted);}
 const params=new Set();(n.params??[]).forEach(p=>names(p,params));const nativePlan=planNativeLocals(n,{parents,hoistedNames:[...hoisted],parameterNames:[...params]});
 // Each exact function hash is admitted only to this read-only planner call.
 const plan=planScalarLocalArrays(n,{parents,nativePlan,sourceSha256:hash,allowedSourceHashes:[hash]});
 const matched=(list)=>{const r=list.find(x=>x.unit===unit&&x.functionId===f.id);if(r)assert.equal(r.sourceSha256,hash,'Profile join mismatch');return r?{samples:r.samples,periodNs:r.periodNs,percent:r.percent}:null;};
 const admitted=plan.arrays.map(a=>({name:a.name,start:a.declaration.start,end:a.declaration.end,length:a.elements.length,indexOrLengthReads:a.reads,indexReads:body.filter(n=>plan.members.get(n)?.array===a&&plan.members.get(n).index!=='length').length,lengthReads:body.filter(n=>plan.members.get(n)?.array===a&&plan.members.get(n).index==='length').length,truthinessReads:a.truthinessReads,initializerStart:a.declaration.init.start,initializerEnd:a.declaration.init.end}));
 if(admitted.length)eligibleFunctions++;
 rows.push({unit,functionId:f.id,name:f.name,sourceSha256:hash,start:f.start,end:f.end,arrayAllocationSites:sites.length,candidateDeclarationSites:body.filter(x=>x.type==='VariableDeclarator'&&x.init?.type==='ArrayExpression').length,sourceProofEligible:admitted.length>0,plannerEligibleArrays:admitted.length,alreadyProductionPinned:scalarArraySourceHashes.includes(hash),excludedAlreadyUnitB:hash==='a0997743bf70f854c4d9ff8d45107cc2fa3a10395a1b68dbab33818c53bd488e',indexOrLengthReads:admitted.reduce((s,a)=>s+a.indexOrLengthReads,0),indexReads:admitted.reduce((s,a)=>s+a.indexReads,0),lengthReads:admitted.reduce((s,a)=>s+a.lengthReads,0),truthinessReads:admitted.reduce((s,a)=>s+a.truthinessReads,0),nearest:matched(matrix.nearestSource),inclusive:matched(matrix.inclusiveSource),admitted,rejection:admitted.length?null:'Existing scalar-array planner admits no array. No individual rejection reason inferred.'});
 }
 units.push({unit,sourceFile:m.filename,sourceSha256:m.sourceSha256,functions:m.functions.length,arrayAllocationSites:unitArrays,eligibleFunctions});console.error(JSON.stringify(units.at(-1)));
}
const ranked=rows.filter(x=>x.sourceProofEligible&&!x.excludedAlreadyUnitB).sort((a,b)=>(b.nearest?.samples??0)-(a.nearest?.samples??0)||(b.inclusive?.samples??0)-(a.inclusive?.samples??0)||b.indexOrLengthReads-a.indexOrLengthReads);ranked.forEach((r,i)=>r.rank=i+1);
for(const[p,h]of Object.entries(inputs))assert.equal(sha(await fs.readFile(p)),h,'Changed analysis input '+p);
const report={version:1,plannerOrigin:{branch:'candidate/scalar-local-arrays',commit:'9e6231fdb4ad53a7c1b40ac024c554f7da50c607',file:'tools/rust-port/scalar-arrays.mjs',adaptation:'Exact copied planner under analysis-only filename; inventory passes only the current exact function hash to its local allowedSourceHashes option.'},analysisComplete:true,semanticallyQualified:false,qualifiesFor10000Target:false,scope:'Read-only structural opportunity inventory over all seven frozen modules. Exact existing planner with inventory-only per-function allowlist, not production admission, emitted-code validation or speed evidence.',ranking:'Eligible functions excluding existing Unit.B pin; nearest-source samples descending, then inclusive samples, then static read sites. Inclusive CPU overlaps; syntax counts do not estimate dynamic allocations saved.',profile:matrix.profile,sourceInputs:inputs,units,totalFunctions:functions,arrayAllocationSites:arrays,functionsWithArrays:rows.length,eligibleFunctions:rows.filter(x=>x.sourceProofEligible).length,rankedCandidates:ranked,functionsWithArraysDetail:rows};await fs.mkdir(resolve(output,'..'),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,totalFunctions:functions,arrayAllocationSites:arrays,eligibleFunctions:report.eligibleFunctions,rankedCandidates:ranked.length,top:ranked.slice(0,8).map(x=>({unit:x.unit,id:x.functionId,arrays:x.plannerEligibleArrays,reads:x.indexOrLengthReads,nearest:x.nearest?.percent,inclusive:x.inclusive?.percent}))}));
