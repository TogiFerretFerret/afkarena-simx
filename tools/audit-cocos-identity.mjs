import {loadBootstrapSourceRecords} from './bootstrap-records.mjs';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),records=await loadBootstrapSourceRecords();
const trackedIdentityProperties=['__instanceId','instanceId','target_instanceId','CandleDogFollowTarId','CandleDogFollowLastValidId','__gmCsdDebugId'];
const token=/instanceId|getNewInstanceId|getInstanceId|classManager|ClassManager|CandleDogFollowTarId|CandleDogFollowLastValidId|__gmCsdDebugId/;
const selected=new Map();
for(const[name,list]of [...records.definitions,...records.globals])for(const r of list)if(token.test(r.source)){
 const key=`${r.file}:${r.start}:${r.end}`;
 if(!selected.has(key))selected.set(key,{...r,owners:[]});selected.get(key).owners.push(name);
}
const rows=[],directApiReferences=[],stringLiterals=[];
for(const record of selected.values()){
 const ast=parse(`(${record.source})`),text=n=>record.source.slice(n.start-1,n.end-1);
 traverse(ast,{MemberExpression(path){
  const property=path.node.property;
  if(!(!path.node.computed&&property.type==='Identifier'&&trackedIdentityProperties.includes(property.name)||path.node.computed&&property.type==='StringLiteral'&&trackedIdentityProperties.includes(property.value)))return;
  const uses=[],queue=[path],seenNodes=new Set(),seenBindings=new Set();
  const add=(kind,p,details={})=>uses.push({kind,start:record.start+p.node.start-1,end:record.start+p.node.end-1,source:text(p.node),...details});
  while(queue.length){
   const value=queue.shift();if(seenNodes.has(value.node))continue;seenNodes.add(value.node);
   const parent=value.parentPath;if(!parent)continue;const n=parent.node;
   if(n.type==='VariableDeclarator'&&n.init===value.node&&n.id.type==='Identifier'){
    const binding=parent.scope.getBinding(n.id.name);if(binding&&!seenBindings.has(binding)){seenBindings.add(binding);queue.push(...binding.referencePaths)}continue;
   }
   if(n.type==='AssignmentExpression'&&n.right===value.node&&n.left.type==='Identifier'){
    const binding=parent.scope.getBinding(n.left.name);if(binding&&!seenBindings.has(binding)){seenBindings.add(binding);queue.push(...binding.referencePaths)}continue;
   }
   if(n.type==='MemberExpression'&&n.computed&&n.property===value.node){add('identity-key-candidate',parent,{container:text(n.object)});continue;}
   if(n.type==='BinaryExpression'){add(['===','!==','==','!='].includes(n.operator)?'equality-candidate':'numeric-or-string-operation',parent,{operator:n.operator});continue;}
   if(n.type==='LogicalExpression'){add('truthiness-or-fallback',parent,{operator:n.operator});queue.push(parent);continue;}
   if(n.type==='ConditionalExpression'){add('conditional-or-sentinel',parent);if(n.test!==value.node)queue.push(parent);continue;}
   if(n.type==='SequenceExpression'){if(n.expressions.at(-1)===value.node)queue.push(parent);else add('discarded-value',parent);continue;}
   if(n.type==='CallExpression'||n.type==='NewExpression'){add('call-escape',parent,{callee:text(n.callee)});continue;}
   if(n.type==='AssignmentExpression'){add(n.left===value.node?'identity-write':'field-escape',parent);continue;}
   if(n.type==='ObjectProperty'){add(n.computed&&n.key===value.node?'identity-object-key-candidate':'object-record-escape',parent);continue;}
   if(n.type==='UnaryExpression'){add('unary-operation',parent,{operator:n.operator});continue;}
   if(n.type==='UpdateExpression'){add('identity-update',parent);continue;}
   if(n.type==='IfStatement'||n.type==='WhileStatement'||n.type==='ForStatement'){add('truthiness-control',parent);continue;}
   if(n.type==='ReturnStatement'){add('return-escape',parent);continue;}
   add('unresolved-value-use',parent);
  }
  rows.push({identityProperty:property.name??property.value,owners:record.owners,file:record.file,start:record.start+path.node.start-1,end:record.start+path.node.end-1,source:text(path.node),uses});
 },StringLiteral(path){if(token.test(path.node.value))stringLiterals.push({file:record.file,start:record.start+path.node.start-1,end:record.start+path.node.end-1,source:text(path.node)})},Identifier(path){if(['ClassManager','classManager','getNewInstanceId','getInstanceId'].includes(path.node.name))directApiReferences.push({owners:record.owners,file:record.file,start:record.start+path.node.start-1,name:path.node.name,context:text(path.parentPath.node)})}});
}
const dedup=new Map();for(const row of rows)dedup.set(`${row.file}:${row.start}:${row.end}`,row);
const reads=[...dedup.values()],counts={};for(const row of reads)for(const use of row.uses)counts[use.kind]=(counts[use.kind]??0)+1;
const sourceCounts={};for(const module of records.ordered){const file=`src/srcmodule/${module}`,source=await readFile(resolve(root,file),'utf8');sourceCounts[file]={sha256:createHash('sha256').update(source).digest('hex'),literalOccurrences:[...source.matchAll(/instanceId|getNewInstanceId|getInstanceId|classManager|ClassManager|CandleDogFollowTarId|CandleDogFollowLastValidId|__gmCsdDebugId/g)].length};}
const keyedContainers=new Map();
for(const row of reads)for(const use of row.uses)if(use.kind==='identity-key-candidate'){
 const match=/\.([A-Za-z_$][\w$]*)$/.exec(use.container);if(!match)continue;
 for(const owner of row.owners){const namespace=owner.split('.')[0],key=namespace+':'+match[1];if(!keyedContainers.has(key))keyedContainers.set(key,{namespace,property:match[1],consumers:[]});}
}
for(const entry of keyedContainers.values())for(const[name,list]of records.definitions){
 if(!name.startsWith(entry.namespace+'.'))continue;
 for(const record of list){
  const needle='.'+entry.property;let from=0;
  while((from=record.source.indexOf(needle,from))>=0){
   const tail=record.source.slice(from+needle.length,from+needle.length+60);
   if(/^\s*\.\s*(length|sort|join|map|reduce|filter|forEach|toString)\b/.test(tail))entry.consumers.push({owner:name,file:record.file,start:record.start+from,kind:'keyspace-operation-candidate',source:record.source.slice(Math.max(0,from-50),from+needle.length+100)});
   from+=needle.length;
  }
  for(const method of ['keys','values','entries','stringify']){
   const prefix=method==='stringify'?'JSON.stringify(':'Object.'+method+'(';
   let at=record.source.indexOf(prefix);while(at>=0){const end=record.source.indexOf(')',at);if(end>=0&&record.source.slice(at,end).includes(needle))entry.consumers.push({owner:name,file:record.file,start:record.start+at,kind:'enumeration-or-serialization-candidate',source:record.source.slice(at,end+1)});at=record.source.indexOf(prefix,at+prefix.length)}
  }
 }
}
const evidenceNames=['DOA.func_isin','ed.searchValueInArray','ed.shakeNode','CandleDog.func_updateFollowTarget','CandleDog.func_commitFollowTarget','GOR.atk2_start','GOR.atk2_takeEffectOn','HFP.init_hero','HFP.func_getBeaconBuffNum','HFP.atk3MonitorBuff_onFinalDamaged'];
for(const[name]of records.definitions)if(/Valkyrie\.ult_atk(Down|Up)Buff_onRemoved$/.test(name))evidenceNames.push(name);
const transitiveEvidence=evidenceNames.flatMap(name=>(new Map(records.definitions).get(name)??[]).map(r=>({name,...r,sha256:createHash('sha256').update(r.source).digest('hex')})));
const vendorFile='tools/bootstrap-vendor-CCClass.js',vendor=await readFile(resolve(root,vendorFile),'utf8');
const managerStart=vendor.indexOf('var ClassManager = function () {'),managerEnd=vendor.indexOf('var classManager = new ClassManager();',managerStart)+'var classManager = new ClassManager();'.length;
const classManagerProof={file:vendorFile,fileSha256:createHash('sha256').update(vendor).digest('hex'),start:managerStart,end:managerEnd,source:vendor.slice(managerStart,managerEnd),constructorAssignmentSites:[...vendor.matchAll(/this\.__instanceId = classManager\.getNewInstanceId\(\)/g)].map(m=>m.index),implication:'Generated class constructors share one monotonically incremented numeric instance counter with render objects. Logical entity IDs/index_in_engine are a separate domain and must not be normalized.'};
const syntaxCoverage={literalOccurrences:Object.values(sourceCounts).reduce((n,r)=>n+r.literalOccurrences,0),trackedMemberReferences:reads.length,directApiReferences:directApiReferences.length,otherStringLiterals:[...new Map(stringLiterals.filter(l=>!reads.some(r=>r.file===l.file&&r.start<=l.start&&l.end<=r.end)).map(l=>[l.file+':'+l.start,l])).values()]};
const conclusions=['Cocos IDs are not arbitrary equality-only tokens: HFP equal-heal selection uses Object.keys numeric index order, choosing the first maximum through a strict greater-than comparison. Arbitrary identity renaming can change the consumed buff and combat result.','Order-preserving positive integer renaming below the array-index limit may preserve some gameplay decisions, but HFP sparse-array length still changes and is part of full mutable state. This is not a passed renaming proof.','The original-source regression in tools/tests/cocos-identity.test.mjs demonstrates both the combat tie change from reversing ID order and the full-state array-length change from monotone compaction.','Other enumerated identity-keyed containers, key-range boundaries, local truthiness/sentinels, escaped fields, renderer/debug string conversion and arbitrary helper callees remain obligations before any semantic ID type/projection can be adopted.','Logical entity IDs/index_in_engine and gameplay counters are a separate domain; no numerical normalization is applied.'];
const report={version:1,syntaxCoverage,conclusions,trackedIdentityProperties,classManagerProof,transitiveEvidence,keyedContainerConsumers:[...keyedContainers.values()].filter(e=>e.consumers.length),status:'Conservative local-binding identity-use inventory, not a proof of opaque identity semantics',sourceCounts,coverage:{selectedExpressionRecords:selected.size,distinctInstanceIdMemberReads:reads.length,localAliasUseKinds:counts,directApiReferences:directApiReferences.length,limitations:['Only sourceRecords-extracted expressions are parsed; complete module literal counts retain potential uncovered top-level uses.','Local bindings/conditional value flow are followed; model-field escapes and arbitrary callees require further interprocedural proof.','Numeric array keys affect length, holes and key enumeration. Identity-key candidates alone do not establish renaming invariance.','Raw numeric __instanceId values remain part of full mutable-state/f64 traces; no normalization is authorized or applied.']},reads,directApiReferences,opaqueIdentityProofPassed:false,normalizationApplied:false};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});await writeFile(resolve(root,'benchmarks/validation/cocos-identity.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.coverage));
