import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import {runInContext} from 'node:vm';
import {staticName} from './source-index.mjs';
import {createBootstrapRuntime} from './bootstrap-runtime.mjs';

const root=resolve(import.meta.dirname,'..');
const file='src/srcmodule/game_battle.js',source=await readFile(resolve(root,file),'utf8');
const classes=new Map(),patches=[],topLevelEffects=[],computedWrites=[];
const hash=code=>createHash('sha256').update(code).digest('hex');
const key=node=>node?.type==='Identifier'?node.name:node?.type==='StringLiteral'?node.value:null;
const record=(node,kind,extra={})=>({kind,file,start:node.start,end:node.end,sha256:hash(source.slice(node.start,node.end)),...extra});
const core=/^ed\.(?:Entity|Unit|Skill|Buff|Ai)$/;
traverse(parse(source),{
 Function(path){path.skip()},
 AssignmentExpression(path){
  const name=staticName(path.node.left),rhs=path.node.right;
  if(name&&core.test(name)&&rhs.type==='CallExpression'&&staticName(rhs.callee)?.endsWith('.extend')&&rhs.arguments[0]?.type==='ObjectExpression'){
   classes.set(name,{name,base:staticName(rhs.callee).slice(0,-7),keys:rhs.arguments[0].properties.map(p=>key(p.key)).filter(Boolean),record:record(path.node,'class_definition')});
  }
  if(/^ed\.(?:Entity|Unit|Skill|Buff|Ai)\.prototype\./.test(name??''))patches.push(record(path.node,'prototype_write',{name,value:record(rhs,'rhs')}));
  if(path.node.left.type==='MemberExpression'&&path.node.left.computed&&staticName(path.node.left)===null)computedWrites.push(record(path.node,'computed_write',{owner:staticName(path.node.left.object),expression:source.slice(path.node.left.start,path.node.left.end)}));
 },
 CallExpression(path){
  const callee=staticName(path.node.callee);
  const enclosing=path.findParent(p=>p.isAssignmentExpression()||p.isVariableDeclarator());
  if(!enclosing)topLevelEffects.push(record(path.node,'top_level_call',{callee,expression:source.slice(path.node.start,Math.min(path.node.end,path.node.start+240))}));
 },
 ForStatement(path){
  if(path.parentPath.isProgram())topLevelEffects.push(record(path.node,'top_level_loop',{expression:source.slice(path.node.start,Math.min(path.node.end,path.node.start+360))}));
 },
});
function available(name,seen=new Set()){
 if(seen.has(name))return new Set();seen.add(name);
 const c=classes.get(name);if(!c)return new Set(['constructor','toString','valueOf','hasOwnProperty']);
 return new Set([...available(c.base,seen),...c.keys]);
}
for(const patch of patches){
 const [,owner,property]=/^(.*)\.prototype\.(.*)$/.exec(patch.name);
 patch.coreOwnOrInherited=available(owner).has(property);
 patch.initialOwn=classes.get(owner)?.keys.includes(property)??false;
 patch.owner=owner;patch.property=property;
}
const report={version:1,source:file,sourceSha256:hash(source),loader:'tools/bootstrap-runtime.mjs',coreClasses:[...classes.values()],prototypeWrites:patches,skippedExistingPrototypeCandidates:patches.filter(p=>p.coreOwnOrInherited),topLevelEffects,computedWrites,live:null};
if(process.argv.includes('--live')){
 const runtime=await createBootstrapRuntime();const{context,ed}=runtime;
 const resolveValue=name=>name.split('.').reduce((o,k)=>o?.[k],context);
 const fingerprint=value=>typeof value==='function'?{type:'function',sha256:hash(Function.prototype.toString.call(value))}:value===undefined?{type:'undefined'}:{type:typeof value,value};
 const diffs=[];
 for(const patch of patches.filter(p=>p.coreOwnOrInherited)){
  const before=fingerprint(resolveValue(patch.name));
  try{runInContext(source.slice(patch.start,patch.end),context,{filename:`${file}:${patch.start}:original-prototype-write`});const after=fingerprint(resolveValue(patch.name));diffs.push({name:patch.name,before,after,changed:JSON.stringify(before)!==JSON.stringify(after),sourceStart:patch.start});}
  catch(error){diffs.push({name:patch.name,before,error:error.message,sourceStart:patch.start});}
 }
 const beforeDescriptor=Object.getOwnPropertyDescriptor(ed,'battleEngine');
 const define=topLevelEffects.find(e=>e.callee==='Object.defineProperty'&&source.slice(e.start,e.end).startsWith('Object.defineProperty(ed,"battleEngine"'));
 let descriptor;
 if(define){
  const engine=ed.battleEngine;
  runInContext(source.slice(define.start,define.end),context,{filename:`${file}:${define.start}:original-battleEngine-descriptor`});
  const assigned={marker:'source-descriptor-probe'};ed.battleEngine=assigned;
  descriptor={source:define,before:{getter:typeof beforeDescriptor?.get==='function',setter:typeof beforeDescriptor?.set==='function',ownDataProperty:!!beforeDescriptor&&'value'in beforeDescriptor},after:{getter:typeof Object.getOwnPropertyDescriptor(ed,'battleEngine')?.get==='function',setter:typeof Object.getOwnPropertyDescriptor(ed,'battleEngine')?.set==='function',privateInstanceMatches:ed._battleEngineInstance===assigned,readReturnsAssigned:ed.battleEngine===assigned}};
  ed.battleEngine=engine;
 }
 const maps=[];
 for(const name of ['attrib_names_x','attrib_names_a'])maps.push({name,expectedCount:ed.attrib_names.length,beforeCount:Object.keys(ed[name]??{}).length,missing:ed.attrib_names.filter(attribute=>ed[name]?.[attribute]===undefined)});
 report.live={prototypeDifferences:diffs,battleEngineDescriptor:descriptor,attributeMaps:maps};
}
await mkdir(resolve(root,'config'),{recursive:true});await writeFile(resolve(root,'config/oracle-init-audit.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({prototypeWrites:patches.length,skippedCandidates:report.skippedExistingPrototypeCandidates.map(p=>p.name),topLevelEffects:topLevelEffects.map(e=>({kind:e.kind,start:e.start,callee:e.callee,expression:e.expression})),computedWrites:computedWrites.length,live:report.live}));
