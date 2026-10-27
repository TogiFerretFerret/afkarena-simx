import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
import {gzipSync} from 'node:zlib';
import {parse,parseExpression} from '@babel/parser';
import traverse from '@babel/traverse';
import assert from 'node:assert/strict';
import {staticName} from './source-index.mjs';
const root=resolve(import.meta.dirname,'..'),sha=text=>createHash('sha256').update(text).digest('hex');
async function files(directory){const out=[];for(const entry of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isDirectory())out.push(...await files(path));else if(entry.name.endsWith('.js'))out.push(path);}return out.sort();}
const indexText=await readFile(resolve(root,'work/source-index.json'),'utf8'),index=JSON.parse(indexText),sourceFiles=[],proxyOccurrences=[],objectPrototypeReferences=[],prototypeHazards=[],sorts=[];
for(const path of await files(resolve(root,'src'))){
 const file=relative(root,path),source=await readFile(path,'utf8');sourceFiles.push({file,utf16Length:source.length,sha256:sha(source)});
 for(const match of source.matchAll(/\bProxy\b/g))proxyOccurrences.push({file,start:match.index,end:match.index+match[0].length,context:source.slice(Math.max(0,match.index-90),match.index+160)});
 for(const match of source.matchAll(/Object\s*(?:\.\s*prototype|\[\s*['"]prototype['"]\s*\])/g)){
  const tail=source.slice(match.index+match[0].length),kind=/^\.toString\.call\(/.test(tail)?'toString.call read':/^\.hasOwnProperty\.call\(/.test(tail)?'hasOwnProperty.call read':'unclassified';
  objectPrototypeReferences.push({file,start:match.index,end:match.index+match[0].length,kind,context:source.slice(Math.max(0,match.index-40),match.index+match[0].length+80)});
 }
 for(const match of source.matchAll(/__defineGetter__|__defineSetter__|__proto__|Symbol\.(?:toStringTag|iterator)|(?:Object|Reflect)\.setPrototypeOf/g))prototypeHazards.push({file,start:match.index,token:match[0],context:source.slice(Math.max(0,match.index-70),match.index+120)});
 const record=index.files.find(record=>record.file===file);assert.ok(record,`Source index omitted ${file}`);
 const byId=new Map(record.functions.map(fn=>[fn.id,fn]));
 for(const call of record.calls.filter(call=>call.callee?.endsWith('.sort'))){
  const text=source.slice(call.start,call.end);let expression;
  try{expression=parseExpression(text);}catch(error){throw Error(`Source index sort slice is stale at ${file}:${call.start}: ${error.message}`);}
  assert.ok(expression.type==='CallExpression'&&staticName(expression.callee)?.endsWith('.sort'),`Stale sort index ${file}:${call.start}`);
  const comparator=expression.arguments[0],calls=[],writes=[],reads=[];
  function walk(node){if(!node||typeof node!=='object')return;
   if(node.type==='CallExpression'||node.type==='NewExpression')calls.push({callee:staticName(node.callee),source:text.slice(node.start,node.end)});
   if(['AssignmentExpression','UpdateExpression','AwaitExpression','YieldExpression'].includes(node.type)||node.type==='UnaryExpression'&&node.operator==='delete')writes.push({type:node.type,source:text.slice(node.start,node.end)});
   if(node.type==='MemberExpression')reads.push(staticName(node));
   for(const [key,value]of Object.entries(node))if(key!=='loc'&&key!=='extra'){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
  }
  if(comparator)walk(comparator);
  const inline=comparator&&['FunctionExpression','ArrowFunctionExpression'].includes(comparator.type),owner=byId.get(call.owner);
  sorts.push({file,start:call.start,end:call.end,sha256:sha(text),owner:owner?{name:owner.name,start:owner.start,end:owner.end}:null,
   comparatorKind:!comparator?'default':inline?'inline':'indirect',comparator:comparator?text.slice(comparator.start,comparator.end):null,
   calls,writes,memberReads:[...new Set(reads)],directRng:calls.some(call=>call.callee==='Math.random'||call.callee==='ed.rand'||call.callee==='ed.randDontChangeSeed'),
   obligation:!comparator?'Default sort coercion, ordering and side effects require their own source domain proof.':!inline?'Resolve comparator identity and transitive behavior before claiming purity.':calls.length||writes.length?'Calls/writes require interprocedural or fresh-state/identity proof.':'No syntactic call/write in inline comparator; purity still requires exact own primitive input reads and absence of coercion/getters/Proxies.'});
 }
}
assert.equal(sourceFiles.length,18);assert.equal(proxyOccurrences.length,1,'Original Proxy footprint changed');assert.ok(objectPrototypeReferences.every(row=>row.kind!=='unclassified'),'Original direct Object.prototype footprint changed');
const counters=[];
for(const file of ['tools/qualification-table-membrane.js','tools/qualification-mutable-table-capsule.js']){
 const source=await readFile(resolve(root,file),'utf8'),ast=parse(source),rows=[];
 traverse(ast,{VariableDeclarator(path){if(path.node.id.type!=='Identifier'||path.node.id.name!=='counters')return;
  assert.equal(path.node.init.type,'ObjectExpression');const binding=path.scope.getBinding('counters');assert.ok(binding);assert.equal(binding.constantViolations.length,0);
  for(const reference of binding.referencePaths){
   const member=reference.parentPath;assert.ok(member.isMemberExpression()&&member.node.object===reference.node&&!member.node.computed,'Private counters must not escape through aliases/computed keys');
   if(member.node.property.name!=='gets')continue;
   const parent=member.parentPath,fn=member.getFunctionParent(),fnOwner=fn?.parentPath;
   const owner=fnOwner?.isObjectProperty()?staticName(fnOwner.node.key):null;
   const kind=parent.isUpdateExpression()&&parent.node.operator==='++'?'increment':parent.isObjectProperty()&&parent.node.value===member.node?'stats-read':'unexpected';
   assert.ok(kind!=='unexpected',`gets acquired a semantic consumer in ${file}`);
   assert.equal(owner,kind==='increment'?'get':'stats');
   rows.push({kind,owner,start:member.node.start,end:member.node.end,source:source.slice(parent.node.start,parent.node.end)});
  }
 }});
 assert.equal(rows.filter(row=>row.kind==='increment').length,1);assert.equal(rows.filter(row=>row.kind==='stats-read').length,1);
 counters.push({file,sha256:sha(source),getsUses:rows,nonEscapingCounterBinding:true,getsControlsBranchOrGameWrite:false});
}
const rngSorts=sorts.filter(row=>row.directRng),battleSorts=sorts.filter(row=>row.file.endsWith('/game_battle.js'));
const compiler=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8'));
const sortingFile=`work/downloads/${compiler.source.directory}/lib/VM/JSLib/Sorting.cpp`,sortingSource=await readFile(resolve(root,sortingFile),'utf8');
const stableNeedle='return (*res != 0) ? (*res < 0) : (index[i] < index[j]);',stableOffset=sortingSource.indexOf(stableNeedle);assert.ok(stableOffset>=0);
const backendSort={file:sortingFile,sha256:sha(sortingSource),start:stableOffset,end:stableOffset+stableNeedle.length,source:stableNeedle,conclusion:'Pinned Hermes quickSort explicitly breaks comparator-zero ties by original array index. Stable ties alone do not require comparator call order/count equality.'};
const sala=battleSorts.find(row=>row.owner?.name==='Sala.basic_onAttackFrame');assert.ok(sala);
const salaContext=createContext({});runInContext('var m={morphingList:[]};var unit={config:{is_summoned:false},buff_effects:{uncontrollable:false},battledata:{getDamage:function(){return 0}}};',salaContext);
const salaComparator=runInContext('('+sala.comparator+')',salaContext),selfResult=salaComparator(salaContext.unit,salaContext.unit);assert.equal(selfResult,-1);
const inconsistentComparator={file:sala.file,start:sala.start,end:sala.end,callSha256:sala.sha256,owner:sala.owner.name,source:sala.comparator,fixture:'Same canonical unit as both operands, empty morphingList, false summon/uncontrollable flags, original damage-read contract returning equal zero.',compareSelf:selfResult,conclusion:'Comparator fails compare(x,x)==0 even without callback mutations. Purity alone cannot establish algorithm-independent sorting/target order.'};
const inventoryFile='benchmarks/validation/table-sort-inventory.json.gz',inventoryText=JSON.stringify({version:1,sorts},null,2)+'\n',inventoryCompressed=gzipSync(inventoryText);
await writeFile(resolve(root,inventoryFile),inventoryCompressed);
const report={version:1,kind:'bounded-source-proxy-observability-and-sort-audit',qualifiesFor10000Target:false,normalizationApplied:false,sourceFiles,index:{file:'work/source-index.json',sha256:sha(indexText),status:'Syntactic index, not reachability; every selected current UTF16 source slice reparsed and hashed'},
 originalProxy:{occurrences:proxyOccurrences,interpretation:'The sole literal Proxy constructor wraps ed.frameViewMgr.addCustomFrameType UI root; its get trap dispatches mainTopFrameShow/Hide events for onEnter/onExit. Original source is NOT universally Proxy-free. This audit does not prove dynamic construction or reachability absent.'},
 objectPrototype:{directReferences:objectPrototypeReferences,hazardTokens:prototypeHazards,conclusion:'All direct literal Object.prototype paths found are toString.call or hasOwnProperty.call reads. No literal direct prototype getter/write path was found; aliases, computed/generated names, dynamic evaluation and transitive generic descriptor helpers remain separate obligations.'},
 privateGetCounters:counters,backendSort,inconsistentComparator,sortSummary:{explicitSortCalls:sorts.length,battleSortCalls:battleSorts.length,directRngComparatorCalls:rngSorts.length,inlineWithCallsOrWrites:sorts.filter(row=>row.comparatorKind==='inline'&&(row.calls.length||row.writes.length)).length},
 conclusions:['The private counters.gets variable is nonescaping; its only uses are one increment in the get trap and one stats() result read. Its numeric value does not choose game branches or writes.',
 'The get trap also executes Reflect.get and child wrapping. Extra reads may invoke inherited getters, custom Proxy traps, object coercions or comparator side effects; private-counter noninterference alone does not prove the entire extra read harmless.',
 'Private JSON table constructors enforce initial own data descriptors/plain Object or Array prototypes, and write membranes reject prototype/descriptor changes. Native/source intrinsic prototype integrity and the actual read keys must still be established for this workload.',
 'Backend sort algorithms can legally invoke comparators different numbers of times. Source contains direct RNG sort comparators, so no general sort-count or table-get-count normalization is valid.',
 'For a specific immutable-table row comparator, varying comparison counts can be diagnostic-only after proving reads are canonical own primitives, comparator is pure/coercion-free, and sorted output ordering/ties match. No such blanket proof is asserted here.'],
 limitations:['Lexical direct-name footprint is bounded evidence, not whole-program alias/eval analysis.','Sort inventory follows statically named .sort calls in an existing syntactic index; unresolved computed invocations and arbitrary comparator callees remain unproved.','No evidence in this report identifies the specific974extra native gets; full report mismatch remains visible.'],directRngSorts:rngSorts,battleSorts,sortInventory:{file:inventoryFile,sha256:sha(inventoryCompressed),decodedSha256:sha(inventoryText),entries:sorts.length}};
await writeFile(resolve(root,'benchmarks/validation/table-proxy-observability.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:sourceFiles.length,originalProxyLiterals:proxyOccurrences.length,objectPrototypeDirectReads:objectPrototypeReferences.length,privateCounterProofs:counters.length,sortCalls:sorts.length,battleSorts:battleSorts.length,directRngSorts:rngSorts.length,normalizationApplied:false}));
