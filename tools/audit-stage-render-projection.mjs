import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import {loadBootstrapSourceRecords} from './bootstrap-records.mjs';
const root=resolve(import.meta.dirname,'..');
const sha=s=>createHash('sha256').update(s).digest('hex');
function analyze(name,record,{receiverArgument=1}={}){
 const ast=parse(`(${record.source})`),aliases=new Map(),links=[],writes=[],calls=[];
 let receiver;
 const text=node=>record.source.slice(node.start-1,node.end-1);
 const reverseLinks=[];
 traverse(ast,{FunctionExpression(path){if(!receiver&&receiverArgument!==null&&path.parentPath.isExpressionStatement())receiver=path.get('params')[receiverArgument]},VariableDeclarator(path){if(path.node.id.type==='Identifier'&&path.node.init)links.push([path.get('id'),path.get('init')])},AssignmentExpression(path){if(path.node.left.type==='Identifier')links.push([path.get('left'),path.get('right')]);if(path.node.left.type==='MemberExpression'&&path.node.right.type==='Identifier')reverseLinks.push([path.get('right'),path.get('left')])}});
 if(receiver?.node?.type==='Identifier')aliases.set(receiver.scope.getBinding(receiver.node.name),new Set(['actor']));
 function roots(path){
  if(!path?.node)return[];
  const n=path.node;
  if(n.type==='Identifier')return [...(aliases.get(path.scope.getBinding(n.name))??[])];
  if(n.type==='ThisExpression')return['actor'];
  if(n.type==='MemberExpression'){
   const property=!n.computed&&n.property.type==='Identifier'?n.property.name:n.property.type==='StringLiteral'||n.property.type==='NumericLiteral'?String(n.property.value):'*';
   return roots(path.get('object')).filter(r=>r.split('.').length<12).map(r=>`${r}.${property}`);
  }
  if(n.type==='LogicalExpression'||n.type==='ConditionalExpression')return [...new Set((n.type==='LogicalExpression'?['left','right']:['consequent','alternate']).flatMap(key=>roots(path.get(key))))];
  if(n.type==='AssignmentExpression')return roots(path.get('right'));
  if(n.type==='SequenceExpression')return roots(path.get('expressions').at(-1));
  return[];
 }
 let changed=true,rounds=0;
 while(changed&&rounds++<16){changed=false;for(const[id,value]of [...links,...reverseLinks]){const binding=id.scope.getBinding(id.node.name);if(!binding)continue;const values=aliases.get(binding)??new Set();for(const r of roots(value))if(!values.has(r)){values.add(r);changed=true}aliases.set(binding,values)}}
 traverse(ast,{AssignmentExpression(path){writes.push({start:record.start+path.node.start-1,left:text(path.node.left),mutatesObject:path.node.left.type==='MemberExpression',roots:roots(path.get('left')),source:text(path.node)})},UpdateExpression(path){writes.push({start:record.start+path.node.start-1,left:text(path.node.argument),mutatesObject:path.node.argument.type==='MemberExpression',roots:roots(path.get('argument')),source:text(path.node)})},CallExpression(path){calls.push({callee:text(path.node.callee),roots:roots(path.get('callee'))})}});
 return{name,file:record.file,start:record.start,end:record.end,sha256:sha(record.source),source:record.source,receiverParameter:receiver?.node?.name??null,aliasFixedPointReached:!changed,modelWrites:writes.filter(w=>w.mutatesObject&&w.roots.some(r=>r==='actor.model'||r.startsWith('actor.model.'))),allWrites:writes,callees:[...new Set(calls.map(c=>c.callee))],modelCallees:calls.filter(c=>c.roots.some(r=>r.startsWith('actor.model.')))};
}
const records=await loadBootstrapSourceRecords(),overrides=[];
for(const[name,list]of records.definitions)if(/actor.*update/i.test(name)&&!name.startsWith('ed.'))for(const record of list)if(record.file==='src/srcmodule/game_battle.js')overrides.push(analyze(name,record));
const baseMethods=[];
const actionCallbacks=[];
for(const[name,list]of records.definitions)for(const record of list){
 if(record.file!=='src/srcmodule/game_battle.js'||!record.source.includes('cc.callFunc'))continue;
 traverse(parse(`(${record.source})`),{CallExpression(path){
  const callee=path.node.callee;
  if(callee.type!=='MemberExpression'||callee.computed||callee.object.type!=='Identifier'||callee.object.name!=='cc'||callee.property.name!=='callFunc')return;
  const argument=path.node.arguments[0];
  if(argument?.type!=='FunctionExpression')throw new Error(`Unresolved original action callback: ${name}`);
  const start=record.start+argument.start-1,end=record.start+argument.end-1,source=record.source.slice(argument.start-1,argument.end-1);
  actionCallbacks.push({owner:name,file:record.file,start,end,sha256:sha(source),source});
 }});
}
for(const className of ['ed.UnitActor','ed.ProjectileActor','ed.ChainActor','ed.Scale3Chain','ed.Puppet','ed.SpineActor','ed.FcaActor','ed.SpineEffect','ed.FcaEffect']){
 for(const record of new Map(records.definitions).get(className)??[]){
  const ast=parse(`(${record.source})`),object=ast.program.body[0].expression.arguments?.[0];
  if(object?.type!=='ObjectExpression')throw new Error(`Unsupported original render class form: ${className}`);
  for(const property of object.properties)if(property.type==='ObjectProperty'&&property.value.type==='FunctionExpression'){
   const start=record.start+property.value.start-1,end=record.start+property.value.end-1;
   const methodRecord={file:record.file,start,end,source:record.source.slice(property.value.start-1,property.value.end-1)};
   baseMethods.push(analyze(`${className}.${property.key.name??property.key.value}`,methodRecord,{receiverArgument:null}));
  }
 }
}
const source=await readFile(resolve(root,'src/srcmodule/game_battle.js'),'utf8');
function fragment(needle,before=0,length=500){const index=source.indexOf(needle);if(index<0)throw new Error(needle);const start=Math.max(0,index-before),end=Math.min(source.length,index+length),text=source.slice(start,end);return{file:'src/srcmodule/game_battle.js',start,end,sha256:sha(text),source:text};}
const evidence={logicActionDuration:fragment('getActionDuration:function',0,250),scale3ChainIndependentModel:fragment('ed.Scale3Chain=',0,600),turnBasedCompletionCallback:fragment('this.model.isEnterStateFinish=!0',110,140),logicConsumesTurnBasedCompletion:fragment('updateEnter_TB:function',0,680)};
const callbackRegistrationCounts=Object.fromEntries(['setActionFinishedCallback','setSpineEvent(','setCompleteListener','setEventListener'].map(token=>[token,source.split(token).length-1]));
const fieldReferences={};
for(const field of ['realKnockSelfFlag','lastHpChangeTick','relatedChain','atk2ImpactTimer']){
 const rows=[];for(const match of source.matchAll(new RegExp(`\\b${field}\\b`,'g'))){const start=Math.max(0,match.index-100),end=Math.min(source.length,match.index+180);rows.push({start,end,source:source.slice(start,end)})}fieldReferences[field]=rows;
}
const report={version:1,status:'Conservative named actor-update alias/write inventory; not a complete renderer-erasure proof',sourceSha256:sha(source),scope:{battleMode:'stage',excludedMode:'turn-based (actor completion explicitly controls battle progression)',namedActorUpdateOverrides:overrides.length,renderBaseMethods:baseMethods.length,actionCallbacks:actionCallbacks.length,coverage:'Every non-ed definition name matching /actor.*update/i in original game_battle.js, plus literal methods of nine original actor/puppet/effect classes and every literal cc.callFunc callback in extracted battle definitions. Name matching does not capture unnamed/computed overrides or transitive helper effects.'},summary:{modelWritingOverrides:overrides.filter(r=>r.modelWrites.length).map(r=>r.name),modelCallingOverrides:overrides.filter(r=>r.modelCallees.length).map(r=>r.name),modelWritingBaseMethods:baseMethods.filter(r=>r.modelWrites.length).map(r=>r.name),fixedPointsReached:[...overrides,...baseMethods].every(r=>r.aliasFixedPointReached),callbackRegistrationCounts},evidence,fieldReferences,overrides,baseMethods,actionCallbacks,
 conclusions:['Original logic animation durations come from UnitPuppet/AnimDuration tables, independently of missing render art binaries.','Scale3Chain graphical model is a separate plain object; its animation termination is not by itself an engine entity termination.','Every original callback must still execute; timers, fields, aliases and source actor-method writes must be preserved.','TechMouse.realKnockSelfFlag is written by an actor update but its source reads are confined to that actor update; the skill reset clears it. Preserving the original method needs device scale state, not texture pixels.','No conclusion about every actor getter, callback, animation event, action completion or transitive helper is implied by this inventory. Unknown paths must remain fail closed.'],qualifiesForRendererErasure:false};
await mkdir(resolve(root,'benchmarks/validation'),{recursive:true});await writeFile(resolve(root,'benchmarks/validation/stage-render-projection.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output:'benchmarks/validation/stage-render-projection.json',...report.scope,...report.summary}));
