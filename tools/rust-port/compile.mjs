import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {parse,parseExpression} from '@babel/parser';
import traverse from '@babel/traverse';
import {emitExpression} from './expressions.mjs';
import {emitStatements} from './statements.mjs';
import {planLocalBindings,planNativeLocals} from './bindings.mjs';

const FUNCTION_TYPES=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
const NATIVE_UTF8_SOURCE_SHA256='5fe05bd8580b1b6d11ff573eab9df79cdb29df580fe1127d1f43afaab2c6fae1';
const NATIVE_COPY_OBJ_SOURCE_SHA256='5d22d4de7adf8237ead58c7a757ed09163f7ee646a22b44a10f12171889d2072';
const NATIVE_CLASS_DISPATCH_SOURCE_SHA256='bdfc22c24f15a0a81d6a915b30bf762c93e8efb115c54ce60c9d7b505f74d425';
const NATIVE_OVERRIDE_DISPATCH_SOURCE_SHA256='a071adecc9cc3cecd27b059f25a2a1eb1b26529e4a3fa15f8501e774dfa6b83f';
const NATIVE_BATTLE_RUN_SOURCE_SHA256='d7f91f446d24282b489ef9943494f0658f778232b5948d66b8d941d3f42e950d';
const sha=text=>createHash('sha256').update(text).digest('hex');
export function rustString(text){let result='"';for(const character of text){const code=character.codePointAt(0);if(character==='"')result+='\\"';else if(character==='\\')result+='\\\\';else if(code>=32&&code<127)result+=character;else if(code<0xd800||code>0xdfff)result+='\\u{'+code.toString(16)+'}';else throw Error('A Rust identifier/metadata string cannot contain an unpaired surrogate');}return result+'"';}
const utf16=text=>Array.from({length:text.length},(_,i)=>text.charCodeAt(i));
const childNodes=node=>Object.entries(node).flatMap(([key,value])=>key==='loc'||key==='extra'||key==='comments'||key==='tokens'?[]:Array.isArray(value)?value.filter(x=>x&&typeof x.type==='string'):value&&typeof value.type==='string'?[value]:[]);
function bindings(pattern){if(pattern.type==='Identifier')return[pattern.name];if(pattern.type==='RestElement')return bindings(pattern.argument);if(pattern.type==='AssignmentPattern')return bindings(pattern.left);if(pattern.type==='ArrayPattern')return pattern.elements.flatMap(x=>x?bindings(x):[]);if(pattern.type==='ObjectPattern')return pattern.properties.flatMap(x=>bindings(x.type==='RestElement'?x.argument:x.value));throw Error('Unsupported binding pattern '+pattern.type);}
function directBody(node){if(node.type==='Program')return node.body;if(node.body.type==='BlockStatement')return node.body.body;return null;}
function strictDirective(node){return(node.directives??node.body?.directives??[]).some(row=>row.value.value==='use strict');}
// Strict functions cannot expose the implicit binding through legacy caller or
// arguments reflection. Keep it whenever a source reference could reach it.
// A nested ordinary function owns arguments; arrows retain their outer scope.
function requiresImplicitArguments(node){
 let used=false,evalReference=false;
 function walk(current,ownsArguments){
  if(current.type==='Identifier'){
   if(current.name==='eval')evalReference=true;
   if(ownsArguments&&current.name==='arguments')used=true;
  }
  if(current!==node&&FUNCTION_TYPES.has(current.type)&&current.type!=='ArrowFunctionExpression'){
   // Computed method names are evaluated in the enclosing scope, unlike bodies.
   if(current.computed&&current.key)walk(current.key,ownsArguments);
   ownsArguments=false;
  }
  for(const child of childNodes(current)){
   if((current.type==='MemberExpression'||current.type==='OptionalMemberExpression')&&!current.computed&&child===current.property)continue;
   if(['ObjectProperty','ObjectMethod','ClassMethod','ClassPrivateMethod'].includes(current.type)&&!current.computed&&child===current.key)continue;
   if(['LabeledStatement','BreakStatement','ContinueStatement'].includes(current.type)&&child===current.label)continue;
   walk(child,ownsArguments);
  }
 }
 for(const parameter of node.params??[])walk(parameter,true);
 walk(node.body,true);return used||evalReference;
}
function lexicalDeclarations(body){return body.flatMap(node=>node.type==='VariableDeclaration'&&node.kind!=='var'?node.declarations.flatMap(d=>bindings(d.id).map(name=>({name,mutable:node.kind==='let'}))):[]);}
function hoists(node){const names=new Set(),functions=[];const body=directBody(node)??[];for(const entry of body)if(entry.type==='FunctionDeclaration'){if(!entry.id)throw Error('Anonymous function declaration');names.add(entry.id.name);functions.push(entry);}
 const walk=current=>{if(FUNCTION_TYPES.has(current.type))return;if(current.type==='VariableDeclaration'&&current.kind==='var')for(const declaration of current.declarations)for(const name of bindings(declaration.id))names.add(name);for(const child of childNodes(current))walk(child);};for(const entry of body)walk(entry);return{names:[...names],functions};}
function lexicalScopeNames(node){
 if(node.type==='Program'||node.type==='BlockStatement')return new Set((node.body??[]).flatMap(entry=>entry.type==='VariableDeclaration'&&entry.kind!=='var'?entry.declarations.flatMap(d=>bindings(d.id)):entry.type==='ClassDeclaration'&&entry.id?[entry.id.name]:[]));
 if(node.type==='SwitchStatement')return new Set(node.cases.flatMap(entry=>[...lexicalScopeNames({type:'BlockStatement',body:entry.consequent})]));
 const declaration=node.type==='ForStatement'?node.init:['ForInStatement','ForOfStatement'].includes(node.type)?node.left:null;
 return new Set(declaration?.type==='VariableDeclaration'&&declaration.kind!=='var'?declaration.declarations.flatMap(d=>bindings(d.id)):[]);
}
function annexBPlan(record,parents){
 const eligible=new WeakSet(),names=new Set();
 const walk=node=>{if(FUNCTION_TYPES.has(node.type)){
  if(node.type!=='FunctionDeclaration')return;const parent=parents.get(node),direct=parent===record.node||parent===record.node.body;
  if(direct)return;
  if(!['BlockStatement','SwitchCase'].includes(parent?.type)){const error=Error('Conditional/labeled function declaration requires Annex B statement normalization');error.node=node;throw error;}
  if(!record.strict){let ancestor=parent,conflict=false;while(ancestor&&ancestor!==record.node){if(lexicalScopeNames(ancestor).has(node.id.name))conflict=true;if(ancestor.type==='CatchClause'&&ancestor.param&&bindings(ancestor.param).includes(node.id.name)){const error=Error('Annex B function shadowing a catch parameter requires separate instantiation semantics');error.node=node;throw error;}ancestor=parents.get(ancestor);}
   if(!conflict){eligible.add(node);names.add(node.id.name);}
  }
  return;
 }for(const child of childNodes(node))walk(child);};
 for(const node of directBody(record.node)??[])walk(node);return{eligible,names:[...names]};
}
function diagnostic(error,node,filename){return{filename,start:node.start??0,end:node.end??0,line:node.loc?.start.line??null,column:node.loc?.start.column??null,nodeType:node.type,reason:error.message??String(error)};}

/** Babel AST -> native Rust execution functions. Unsupported bodies are explicit
 * hard-failure stubs, listed in the manifest; no JavaScript backend is emitted. */
export function compileSource(source,{filename='input.js',mode='script',moduleName='generated',allowUnsupported=true,emitRust=true,sourcePoolPath=null,largeBody=false,cacheLocalBindings=true,staticLiteralStrings=true,literalPropertySlots=true,numericLiteralKeys=true,nativeNumericOps=true,sourceSpecializations=true,nativeBattleGc=false,nativeLocalBindings=true}={}){
 const root=mode==='function'?parseExpression(source,{sourceType:'script'}):parse(source,{sourceType:mode==='module'?'module':'script',allowReturnOutsideFunction:false}).program;
 if(mode==='function'&&!FUNCTION_TYPES.has(root.type))throw Error('--function input must be a function expression');
 // V8 legacy f.arguments snapshots current uncaptured formal cells, but raw
 // call slots for context-captured formals, implicit arguments use, or eval.
 // Resolve actual bindings rather than treating same-spelled shadows as captures.
 const parameterCaptures=new WeakMap(),implicitArgumentsUsed=new WeakSet(),directEvalContexts=new WeakSet();
 const scopeTree={type:'File',program:root.type==='Program'?root:{type:'Program',sourceType:'script',directives:[],body:[{type:'ExpressionStatement',expression:root}]}};
 traverse(scopeTree,{Function(path){
  parameterCaptures.set(path.node,(path.node.params??[]).map(parameter=>{
   if(parameter.type!=='Identifier')return false;
   const binding=path.scope.getBinding(parameter.name);
   if(!binding)return false;
   return [...binding.referencePaths,...binding.constantViolations].some(reference=>(reference.isFunctionDeclaration()?reference.parentPath.scope:reference.scope).getFunctionParent()?.path.node!==path.node);
  }));
 },Identifier(path){
  if(path.node.name!=='arguments')return;
  const parent=path.parent;
  const write=(parent.type==='AssignmentExpression'&&parent.left===path.node)||(parent.type==='UpdateExpression'&&parent.argument===path.node)||(parent.type==='VariableDeclarator'&&parent.id===path.node&&parent.init);
  if(!path.isReferencedIdentifier()&&!write)return;
  let owner=path.scope.getFunctionParent();
  while(owner?.path.node.type==='ArrowFunctionExpression')owner=owner.parent?.getFunctionParent();
  if(!owner)return;
  const binding=path.scope.getBinding('arguments');
  if(!binding||(binding.kind==='var'&&binding.scope===owner))implicitArgumentsUsed.add(owner.path.node);
 },CallExpression(path){
  if(path.node.callee.type!=='Identifier'||path.node.callee.name!=='eval')return;
  let owner=path.scope.getFunctionParent();while(owner){directEvalContexts.add(owner.path.node);owner=owner.parent?.getFunctionParent();}
 }});
 const parents=new WeakMap(),records=[],recordByNode=new WeakMap(),inventory={};
 function collect(node,parent,inheritedStrict){parents.set(node,parent);inventory[node.type]=(inventory[node.type]??0)+1;const isFunction=FUNCTION_TYPES.has(node.type);let strict=inheritedStrict;
  if(node.type==='Program'||isFunction){strict=inheritedStrict||strictDirective(node)||node.type==='ClassMethod'||node.type==='ClassPrivateMethod';const record={node,id:records.length,strict,diagnostics:[]};records.push(record);recordByNode.set(node,record);}
  for(const child of childNodes(node))collect(child,node,strict);
 }
 collect(root,null,mode==='module');
 const compiled=[],helperFunctions=[];
 const inferName=node=>{if(node.id)return node.id.name;const parent=parents.get(node);if(parent?.type==='VariableDeclarator'&&parent.init===node&&parent.id.type==='Identifier')return parent.id.name;if(parent?.type==='AssignmentExpression'&&parent.right===node&&parent.left.type==='Identifier')return parent.left.name;return'';};
 function closure(node,ctx,options={}){
  const record=recordByNode.get(node);ctx.functionDependencies.add(`js_function_${record?.id}`);if(!record)throw Error('Internal missing function registry for '+node.type);
  const name=node.id?.name??options.inferredName??inferName(node),arity=node.params.length;
  let rhs;
  if(node.type==='FunctionExpression'&&node.id)rhs=`rt.make_named_closure(js_function_${record.id}, ${ctx.env}, ${arity}, ${rustString(name)}, ${record.strict})`;
  else rhs=`rt.make_closure_with_flags(js_function_${record.id}, ${ctx.env}, ${arity}, ${rustString(name)}, ${record.strict}, ${node.type==='ArrowFunctionExpression'?`Some(${ctx.thisValue})`:'None'})`;
  const value=ctx.temp(rhs);if(!emitRust)return value;if(node.type==='ObjectMethod')ctx.emit(`rt.set_function_constructable(${value}, false)?;`);if(sourcePoolPath)ctx.emit(`rt.set_function_source_range(${value}, __JS_SOURCE_POOL, ${node.start}, ${node.end})?;`);else ctx.emit(`rt.set_function_source(${value}, &[${utf16(source.slice(node.start,node.end)).join(',')}])?;`);return value;
 }
 function context(record){const lines=[],state={counter:0};
  const ctx={env:'env',functionEnv:'env',thisValue:'this',strict:record.strict,staticLiteralStrings,literalPropertySlots,numericLiteralKeys,nativeNumericOps,pendingLabels:[],functionDependencies:new Set(),annexBDeclarations:new WeakSet(),emit(line){if(emitRust)lines.push(line);},fresh(prefix='temporary'){return prefix.replace(/[^A-Za-z0-9_]/g,'_')+'_'+state.counter++;},temp(rhs){const name=this.fresh('value');this.emit(`let ${name} = ${rhs};`);return name;},expression(node){return emitExpression(node,this);},makeClosure(node,options){return closure(node,this,options);},child(overrides={}){return Object.assign(Object.create(this),overrides);},rustString,instantiateBlockFunctions(functions,local){const unique=new Map();for(const fn of functions)unique.set(fn.id.name,fn);for(const name of unique.keys())local.emit(`rt.declare_lexical(${local.env}, ${rustString(name)}, true)?;`);for(const[name,fn]of unique){const value=local.makeClosure(fn);local.emit(`rt.initialize(${local.env}, ${rustString(name)}, ${value})?;`);}},unsupported(node,reason){const error=Error(reason);error.node=node;throw error;}};
  return{ctx,lines};
 }
 function ownWeight(node){if(!node)return 0;if(FUNCTION_TYPES.has(node.type))return 1;return 1+childNodes(node).reduce((sum,child)=>sum+ownWeight(child),0);}
 function sequenceLeaves(expression){return expression.type==='SequenceExpression'?expression.expressions.flatMap(sequenceLeaves):[expression];}
 function flattenStatements(body){return body.flatMap(statement=>{
  if(statement.type==='ExpressionStatement'&&statement.expression.type==='SequenceExpression')return sequenceLeaves(statement.expression).map(expression=>({...statement,expression}));
  if(statement.type==='VariableDeclaration'&&statement.declarations.length>1)return statement.declarations.map(declaration=>({...statement,declarations:[declaration]}));
  if(statement.type==='ReturnStatement'&&statement.argument?.type==='SequenceExpression'){const values=sequenceLeaves(statement.argument);return[...values.slice(0,-1).map(expression=>({type:'ExpressionStatement',expression,start:expression.start,end:expression.end,loc:expression.loc})),{...statement,argument:values.at(-1)}];}
  return[statement];
 });}
 function chunks(items,weight,maxWeight,maxItems){const result=[];let current=[],size=0;for(const item of items){const next=weight(item);if(current.length&&(size+next>maxWeight||current.length>=maxItems)){result.push(current);current=[];size=0;}current.push(item);size+=next;}if(current.length)result.push(current);return result;}
 function instantiateGroups(node,ctx,declarations,params,body){const groups=[];
  for(let index=0;index<params.length;index++){const name=rustString(params[index].name);groups.push(local=>{local.emit(`rt.declare(env, ${name}, Value::Undefined)?;`);local.emit(`rt.assign(env, ${name}, args.get(${index}).copied().unwrap_or(Value::Undefined), false)?;`);});}
  if(node.type!=='Program'&&node.type!=='ArrowFunctionExpression'){
   const parameterNames=params.map(p=>rustString(p.name)).join(',');
   if(!ctx.strict){
    const rawSlots=(parameterCaptures.get(node)??[]).map(captured=>captured||implicitArgumentsUsed.has(node)||directEvalContexts.has(node));
    groups.push(local=>local.emit(`rt.register_lazy_arguments(env, &[${parameterNames}], args, &[${rawSlots.join(',')}])?;`));
   }
   if(!params.some(p=>p.name==='arguments')&&requiresImplicitArguments(node))groups.push(local=>{const argsValue=local.temp(`rt.arguments_object(env, &[${parameterNames}], args, ${local.strict})?`);local.emit(`rt.declare(env, "arguments", ${argsValue})?;`);});
  }
  for(const name of declarations.names)if(!ctx.nativeBindingNames?.has(name))groups.push(local=>local.emit(`rt.declare(env, ${rustString(name)}, Value::Undefined)?;`));
  for(const binding of lexicalDeclarations(body??[]))groups.push(local=>local.emit(`rt.declare_lexical(env, ${rustString(binding.name)}, ${binding.mutable})?;`));
  for(const fn of declarations.functions)groups.push(local=>{const value=local.makeClosure(fn);local.emit(`rt.assign(env, ${rustString(fn.id.name)}, ${value}, false)?;`);});
  return groups;
 }
 const splitOptions=largeBody?{minimumNodes:3000,maxNodes:500,maxStatements:24,maxInitGroups:32,...(typeof largeBody==='object'?largeBody:{})}:null;
 for(const record of records){const{node,id}=record,{ctx,lines}=context(record);let supported=true;const localHelpers=[];
  try{
   if(node.async||node.generator)ctx.unsupported(node,'Async/generator execution is not implemented');
   if(node.type==='ClassMethod'||node.type==='ClassPrivateMethod')ctx.unsupported(node,'Class home-object/super semantics are not implemented');
   for(const parameter of node.params??[])if(parameter.type!=='Identifier')ctx.unsupported(parameter,'Non-simple parameter initialization and TDZ are not implemented');
   // This source-pinned loader otherwise allocates an element/property for each
   // of the 97 MiB input bytes in a runtime without collection. The Rust helper
   // accepts only its proven intrinsic domain; a raw guard miss executes every
   // original statement below, and closure source metadata remains unchanged.
   if(sourceSpecializations&&node.type!=='Program'&&sha(source.slice(node.start,node.end))===NATIVE_UTF8_SOURCE_SHA256){
    record.sourceSpecialization='native-utf8-loader-v1';
    ctx.emit('if let Some(value) = rt.try_native_decode_utf8(args.first().copied().unwrap_or(Value::Undefined), parent)? { return Ok(value); }');
   }
   // Only the exact original ed.copyObj body is eligible. The native helper
   // guards the captured binding chain and flat object descriptors before doing
   // any source-visible work; every miss executes the unchanged body below.
   if(sourceSpecializations&&node.type!=='Program'&&sha(source.slice(node.start,node.end))===NATIVE_COPY_OBJ_SOURCE_SHA256){
    record.sourceSpecialization='native-copy-obj-v1';
    ctx.emit('if let Some(value) = rt.try_native_copy_obj(args.first().copied().unwrap_or(Value::Undefined), parent)? { return Ok(value); }');
   }
   if(sourceSpecializations&&node.type!=='Program'&&sha(source.slice(node.start,node.end))===NATIVE_OVERRIDE_DISPATCH_SOURCE_SHA256){
    record.sourceSpecialization='native-override-dispatch-v1';
    ctx.emit('if let Some(value) = rt.try_native_override_dispatch(this, args, parent)? { return Ok(value); }');
   }
   if(sourceSpecializations&&node.type!=='Program'&&sha(source.slice(node.start,node.end))===NATIVE_CLASS_DISPATCH_SOURCE_SHA256){
    record.sourceSpecialization='native-class-dispatch-v1';
    ctx.emit(`if let Some(value) = rt.try_native_class_dispatch(this, args, parent, ${ctx.strict})? { return Ok(value); }`);
   }
   if(node.type==='Program')ctx.emit('let env = parent;');else ctx.emit('let env = rt.child_env(parent);');
   const body=directBody(node),declarations=hoists(node),params=node.params??[],annex=annexBPlan(record,parents);ctx.annexBDeclarations=annex.eligible;for(const name of annex.names)if(!declarations.names.includes(name))declarations.names.push(name);
   let groups=instantiateGroups(node,ctx,declarations,params,body);const ownNodes=body?body.reduce((sum,item)=>sum+ownWeight(item),0):ownWeight(node.body);
   const split=!!splitOptions&&!!body&&(ownNodes>=splitOptions.minimumNodes||groups.length>splitOptions.maxInitGroups*4);record.split=split;record.estimatedOwnAstNodes=ownNodes;
   // The verified root driver may collect only at this exact outer battle-loop
   // backedge. The body statement closure has finished, all its SSA temporaries
   // are dead, and every surviving source binding remains in the rooted env.
   // Helper-split functions and future native-local promotion are excluded.
   if(nativeBattleGc&&!split&&node.type!=='Program'&&sha(source.slice(node.start,node.end))===NATIVE_BATTLE_RUN_SOURCE_SHA256){
    const loops=body.filter(statement=>statement.type==='ForStatement');
    if(loops.length!==1)ctx.unsupported(node,'Pinned battle GC loop shape changed');
    const loop=loops[0];record.battleGcSafePoints=[];record.battleGcRoot=true;
    ctx.battleLoopBackedge=(candidate,local)=>{
     if(candidate!==loop||local.nativeBindingNames?.size)return;
     local.emit(`rt.collect_native_battle_backedge(${local.functionEnv}, parent)?;`);
     record.battleGcSafePoints.push({kind:'outer-battle-loop-backedge',start:loop.start,end:loop.end,environment:'function',sourceSha256:NATIVE_BATTLE_RUN_SOURCE_SHA256});
    };
   }
   if(split){
    const makePart=(kind,index,build,estimatedNodes)=>{const name=`js_part_${id}_${kind}_${index}`,part=context(record);part.ctx.annexBDeclarations=annex.eligible;build(part.ctx);const rust=`pub fn ${name}(rt: &mut Runtime, this: Value, args: &[Value], env: EnvId) -> JsResult<Completion> {\n${part.lines.join('\n')}\n}`;localHelpers.push({name,ownerId:id,kind,rust,estimatedNodes,dependencies:[...part.ctx.functionDependencies]});ctx.functionDependencies.add(name);const result=ctx.temp(`${name}(rt, this, args, env)?`);ctx.emit(`match ${result} { Completion::Normal => {}, Completion::Return(value) => return Ok(value), _ => unreachable!("Invalid completion escaping a source function body") }`);};
    chunks(groups,()=>1,splitOptions.maxInitGroups,splitOptions.maxInitGroups).forEach((group,index)=>makePart('init',index,local=>{for(const emit of group)emit(local);local.emit('Ok(Completion::Normal)');},group.length));
    chunks(flattenStatements(body),ownWeight,splitOptions.maxNodes,splitOptions.maxStatements).forEach((group,index)=>makePart('body',index,local=>{const completion=emitStatements(group,local);local.emit(`Ok(${completion})`);},group.reduce((sum,item)=>sum+ownWeight(item),0)));
    ctx.emit('Ok(Value::Undefined)');
   }else{
    const nativePlan=nativeLocalBindings&&!record.battleGcRoot?planNativeLocals(node,{parents,hoistedNames:declarations.names,parameterNames:params.map(parameter=>parameter.name)}):{names:[],eligible:()=>false},nativeBindings=new Map();
    for(const name of nativePlan.names){const binding=ctx.fresh('native_local');nativeBindings.set(name,binding);ctx.emit(`let mut ${binding} = Value::Undefined;`);}
    ctx.nativeBindingNames=new Set(nativePlan.names);record.nativeBindings=nativePlan.names;
    ctx.nativeLocal=(name,identifier)=>nativePlan.eligible(name,identifier)?nativeBindings.get(name):undefined;
    groups=instantiateGroups(node,ctx,declarations,params,body);
    for(const emit of groups)emit(ctx);
    const localPlan=cacheLocalBindings?planLocalBindings(node,{parents,hoistedNames:declarations.names,parameterNames:params.map(parameter=>parameter.name)}):{names:[],eligible:()=>false},bindingRefs=new Map();record.cachedBindings=localPlan.names.filter(name=>!nativeBindings.has(name)).length;
    for(const name of localPlan.names)if(!nativeBindings.has(name))bindingRefs.set(name,ctx.temp(`rt.resolve_binding(env, ${rustString(name)})?`));
    ctx.knownBinding=(name,identifier)=>localPlan.eligible(name,identifier)?bindingRefs.get(name):undefined;
    if(body){const completion=emitStatements(body,ctx);ctx.emit(`match ${completion} { Completion::Normal => Ok(Value::Undefined), Completion::Return(value) => Ok(value), _ => unreachable!("Babel accepted an invalid function completion") }`);}
    else{const value=ctx.expression(node.body);ctx.emit(`Ok(${value})`);}
   }
  }catch(error){supported=false;record.diagnostics.push(diagnostic(error,error.node??node,filename));}
  record.supported=supported;record.dependencies=supported?[...ctx.functionDependencies]:[];record.helpers=supported?localHelpers.map(part=>part.name):[];
  if(supported&&emitRust)helperFunctions.push(...localHelpers);
  const contents=supported?lines.join('\n'): `Err(JsError::Unsupported(${rustString(record.diagnostics[0].reason)}.into()))`;
  if(emitRust)compiled.push(`pub fn js_function_${id}(rt: &mut Runtime, this: Value, args: &[Value], parent: EnvId) -> JsResult<Value> {\n${contents}\n}`);
 }
 const first=records[0],entry=!emitRust?'':mode==='function'?(()=>{const{ctx,lines}=context(first);ctx.env='parent';ctx.thisValue='Value::Undefined';const value=ctx.makeClosure(root);ctx.emit(`Ok(${value})`);return`pub fn create_function(rt: &mut Runtime, parent: EnvId) -> JsResult<Value> {\n${lines.join('\n')}\n}`;})():`pub fn run(rt: &mut Runtime, env: EnvId, this: Value) -> JsResult<Value> { js_function_0(rt, this, &[], env) }`;
 const diagnostics=records.flatMap(record=>record.diagnostics),manifest={version:1,moduleName,filename,mode,sourceSha256:sha(source),sourceUtf16Length:source.length,sourcePoolPath,emitsRust:emitRust,diagnosticsScope:'First lowering failure for each complete function body; every AST node and function is inventoried. A failed function body is an explicit Unsupported stub, never partially emitted.',astNodes:Object.values(inventory).reduce((a,b)=>a+b,0),astNodeTypes:inventory,largeBody:splitOptions,cacheLocalBindings,staticLiteralStrings,literalPropertySlots,numericLiteralKeys,nativeNumericOps,sourceSpecializations,nativeBattleGc,nativeLocalBindings,functions:records.map(({node,id,strict,supported,diagnostics,split,estimatedOwnAstNodes,helpers,cachedBindings,sourceSpecialization,battleGcSafePoints,nativeBindings})=>({id,nativeBindings:nativeBindings??[],battleGcSafePoints:battleGcSafePoints??[],sourceSpecialization:sourceSpecialization??null,split,estimatedOwnAstNodes,helpers,cachedBindings:cachedBindings??0,name:node.id?.name??inferName(node),start:node.start,end:node.end,line:node.loc?.start.line,column:node.loc?.start.column,strict,supported,sourceSha256:sha(source.slice(node.start,node.end)),diagnostics})),compiledFunctions:records.filter(r=>r.supported).length,unsupportedFunctions:records.filter(r=>!r.supported).length,complete:diagnostics.length===0,diagnostics,semanticallyQualified:false,executionBackend:'Generated Rust with native js-runtime; no JS interpreter or engine fallback.',qualification:'Compile coverage is not semantic qualification. Unsupported bodies raise uncatchable internal Unsupported errors. Differential evidence must be recorded separately.'};
 if(!allowUnsupported&&!manifest.complete){const error=Error('Unsupported syntax: '+diagnostics.map(d=>`${d.filename}:${d.line}:${d.column}: ${d.reason}`).join('\n'));error.manifest=manifest;throw error;}
 const header=`// Generated by tools/rust-port/compile.mjs; source SHA-256 ${manifest.sourceSha256}
#![allow(unused_imports,unused_variables,unused_mut,dead_code,unreachable_patterns,unused_assignments)]
use js_runtime::{Runtime,Value,EnvId,JsResult,JsError,Completion,BinaryOp,UnaryOp};
${sourcePoolPath?`pub static __JS_SOURCE_POOL: &[u8] = include_bytes!(${rustString(sourcePoolPath)});`:''}
`;
 const rust=emitRust?`${header}\n${compiled.join('\n\n')}\n\n${helperFunctions.map(part=>part.rust).join('\n\n')}\n\n${entry}\n`:null;
 let sourcePool=null;if(emitRust&&sourcePoolPath){sourcePool=Buffer.allocUnsafe(source.length*2);for(let index=0;index<source.length;index++)sourcePool.writeUInt16LE(source.charCodeAt(index),index*2);}
 return{rust,manifest,header,entry,functions:compiled.map((rust,id)=>({id,name:`js_function_${id}`,rust,supported:records[id].supported,dependencies:records[id].dependencies})),helpers:helperFunctions,sourcePool};
}

async function main(){const input=process.argv[2];if(!input||input.startsWith('--'))throw Error('Usage: node tools/rust-port/compile.mjs INPUT.js --out OUTPUT.rs [--function] [--reject-unsupported]');const at=process.argv.indexOf('--out');if(at<0)throw Error('--out is required');const output=resolve(process.argv[at+1]),source=await readFile(resolve(input),'utf8'),result=compileSource(source,{filename:input,mode:process.argv.includes('--function')?'function':'script'});await mkdir(dirname(output),{recursive:true});await writeFile(output,result.rust);await writeFile(output+'.manifest.json',JSON.stringify(result.manifest,null,2)+'\n');console.log(JSON.stringify({output,compiledFunctions:result.manifest.compiledFunctions,unsupportedFunctions:result.manifest.unsupportedFunctions,complete:result.manifest.complete}));if(process.argv.includes('--reject-unsupported')&&!result.manifest.complete)process.exitCode=1;}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))await main();
