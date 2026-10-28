// Statement lowering uses explicit ECMAScript abrupt completions. Rust closures
// delimit exception propagation, so a generated `?` never skips a source catch.
import {emitReference,writeReference} from './expressions.mjs';

function unsupported(node,reason){const where=node?.loc?.start,error=new Error(`Unsupported ${node?.type??'statement'}${where?` at ${where.line}:${where.column}`:''}: ${reason}`);error.node=node;throw error;}
const quote=value=>JSON.stringify(value);
function child(ctx,overrides){if(typeof ctx.child!=='function')throw new Error('Statement context requires child(overrides)');return ctx.child(overrides);}
function capture(ctx,body){const name=ctx.fresh('statement_result');ctx.emit(`let ${name}: JsResult<Completion> = (|| -> JsResult<Completion> {`);body();ctx.emit('})();');return name;}
function propagate(ctx,value){ctx.emit(`if !matches!(${value}, Completion::Normal) { return Ok(${value}); }`);}
function normal(ctx){ctx.emit('Ok(Completion::Normal)');}
function bindingName(pattern){if(pattern?.type!=='Identifier')unsupported(pattern,'expected an identifier binding');return pattern.name;}
function boundNames(pattern){switch(pattern?.type){case 'Identifier':return[pattern.name];case 'AssignmentPattern':return boundNames(pattern.left);case 'ObjectPattern':return pattern.properties.flatMap(property=>boundNames(property.type==='RestElement'?property.argument:property.value));case 'RestElement':return boundNames(pattern.argument);default:unsupported(pattern,'binding pattern is not implemented');}}
function string(ctx,value){const units=Array.from({length:String(value).length},(_,i)=>String(value).charCodeAt(i));return ctx.temp(`rt.string_utf16(&[${units.join(',')}])`);}
function bindPattern(ctx,pattern,value,kind){
 if(pattern.type==='Identifier'){const native=kind==='var'&&typeof ctx.nativeLocal==='function'?ctx.nativeLocal(pattern.name,pattern):null;if(native){ctx.emit(`${native} = ${value};`);return;}ctx.emit(kind==='var'?`rt.assign(${ctx.env}, ${quote(pattern.name)}, ${value}, ${ctx.strict})?;`:`rt.initialize(${ctx.env}, ${quote(pattern.name)}, ${value})?;`);return;}
 if(pattern.type==='AssignmentPattern'){const local=ctx.fresh('binding_default');ctx.emit(`let mut ${local} = ${value};`);ctx.emit(`if matches!(${local}, Value::Undefined) {`);const expression=pattern.right,defaultValue=['FunctionExpression','ArrowFunctionExpression'].includes(expression.type)&&!expression.id&&pattern.left.type==='Identifier'?ctx.makeClosure(expression,{inferredName:pattern.left.name}):ctx.expression(expression);ctx.emit(`${local} = ${defaultValue};`);ctx.emit('}');bindPattern(ctx,pattern.left,local,kind);return;}
 if(pattern.type==='ObjectPattern'){ctx.emit(`rt.require_object_coercible(${value})?;`);for(const property of pattern.properties){if(property.type==='RestElement')unsupported(property,'object rest binding is not implemented');if(property.type!=='ObjectProperty')unsupported(property,'object binding property is not implemented');let key;if(property.computed){const raw=ctx.expression(property.key);key=ctx.temp(`rt.to_property_key(${raw})?`);}else key=string(ctx,property.key.type==='Identifier'?property.key.name:property.key.value);const member=ctx.temp(`rt.get(${value}, ${key})?`);bindPattern(ctx,property.value,member,kind);}return;}
 unsupported(pattern,'binding pattern is not implemented');
}
function declarationKind(node){if(!['var','let','const'].includes(node.kind))unsupported(node,'resource-management declaration is not implemented');}
function lexicalNames(statements){const result=[];for(const node of statements){if(node.type==='VariableDeclaration')declarationKind(node);if(node.type==='VariableDeclaration'&&node.kind!=='var')for(const declaration of node.declarations)result.push(...boundNames(declaration.id).map(name=>({name,mutable:node.kind==='let'})));else if(node.type==='ClassDeclaration')unsupported(node,'class declarations are not implemented');}return result;}
function declareLexicals(ctx,statements){for(const item of lexicalNames(statements))ctx.emit(`rt.declare_lexical(${ctx.env}, ${quote(item.name)}, ${item.mutable})?;`);}
function instantiateFunctions(ctx,local,statements,env){
 const functions=statements.filter(statement=>statement.type==='FunctionDeclaration');
 if(functions.length){
  if(typeof ctx.instantiateBlockFunctions==='function')ctx.instantiateBlockFunctions(functions,local);
  else {
   if(!ctx.strict)unsupported(functions[0],'non-strict block function requires Annex B instantiation');
   for(const fn of functions)local.emit(`rt.declare_lexical(${env}, ${quote(fn.id.name)}, true)?;`);
   for(const fn of functions){const closure=local.makeClosure(fn);local.emit(`rt.initialize(${env}, ${quote(fn.id.name)}, ${closure})?;`);}
  }
 }
}
function block(ctx,node){
 // An empty declarative environment contributes no names to resolution. Reuse
 // its parent unless this block owns lexical declarations or block functions.
 // Nested blocks, lexical loop heads, and catch parameters instantiate their
 // own environments independently; var bindings remain function-hoisted.
 const ownsBindings=lexicalNames(node.body).length!==0||node.body.some(statement=>statement.type==='FunctionDeclaration');
 const env=ownsBindings?ctx.temp(`rt.child_block_env(${ctx.env})`):ctx.env,local=child(ctx,{env,pendingLabels:[]});
 declareLexicals(local,node.body);
 instantiateFunctions(ctx,local,node.body,env);
 const completion=emitStatements(node.body,local);ctx.emit(`Ok(${completion})`);
}
function declaration(ctx,node){
 declarationKind(node);
 for(const item of node.declarations){if(node.kind==='var'&&!item.init)continue;const value=item.init?ctx.expression(item.init):'Value::Undefined';bindPattern(ctx,item.id,value,node.kind);}
 normal(ctx);
}
function labels(ctx){return ctx.pendingLabels??[];}
function handlesLabel(ctx,binding){const own=labels(ctx);return own.length?own.map(label=>`${binding} == Some(${quote(label)})`).join(' || '):'false';}
function loopBody(ctx,body,after){
 const local=child(ctx,{pendingLabels:[]}),completion=emitStatement(body,local),label=ctx.fresh('target_label');
 ctx.emit(`match ${completion} {`);
 ctx.emit('Completion::Normal | Completion::Continue(None) => {},');
 ctx.emit(`Completion::Continue(${label}) if ${handlesLabel(ctx,label)} => {},`);
 ctx.emit('Completion::Break(None) => break,');
 ctx.emit(`Completion::Break(${label}) if ${handlesLabel(ctx,label)} => break,`);
 ctx.emit('other => return Ok(other),');ctx.emit('}');if(after)after();
}
function forStatement(ctx,node){
 let local=ctx,loopNames=[];
 if(node.init?.type==='VariableDeclaration'&&node.init.kind!=='var'){
  const env=ctx.fresh('iteration_env');ctx.emit(`let mut ${env} = rt.child_block_env(${ctx.env});`);local=child(ctx,{env});
  declareLexicals(local,[node.init]);loopNames=node.init.declarations.flatMap(item=>boundNames(item.id));
 }
 if(node.init){if(node.init.type==='VariableDeclaration'){const value=emitStatement(node.init,local);propagate(local,value);}else local.expression(node.init);}
 const clone=()=>{if(loopNames.length)local.emit(`${local.env} = rt.clone_loop_env(${local.env}, &[${loopNames.map(quote).join(', ')}])?;`);};
 clone();local.emit('loop {');
 if(node.test){const condition=local.expression(node.test);local.emit(`if !rt.truthy(${condition}) { break; }`);}
 loopBody(local,node.body,()=>{local.battleLoopBackedge?.(node,local);clone();if(node.update)local.expression(node.update);});local.emit('}');normal(ctx);
}
function forInStatement(ctx,node){
 if(node.left.type==='VariableDeclaration')declarationKind(node.left);
 let head=ctx;
 if(node.left.type==='VariableDeclaration'&&node.left.kind!=='var'){const env=ctx.temp(`rt.child_block_env(${ctx.env})`);head=child(ctx,{env});declareLexicals(head,[node.left]);}
 const value=head.expression(node.right),iterator=ctx.fresh('for_in_iterator');ctx.emit(`let mut ${iterator} = rt.for_in_iter(${value})?;`);
 const key=ctx.fresh('for_in_key');ctx.emit(`while let Some(${key}) = rt.for_in_next(&mut ${iterator})? {`);
 let local=ctx;
 if(node.left.type==='VariableDeclaration'){
  if(node.left.declarations.length!==1)unsupported(node.left,'for-in requires exactly one declaration');
  const declaration=node.left.declarations[0];
  if(declaration.init)unsupported(declaration,'legacy initialized for-in declaration is not implemented');
  if(node.left.kind!=='var'){const env=ctx.temp(`rt.child_block_env(${ctx.env})`);local=child(ctx,{env});declareLexicals(local,[node.left]);}
  bindPattern(local,declaration.id,key,node.left.kind);
 }else{const ref=emitReference(node.left,ctx);writeReference(ref,key,ctx);}
 loopBody(local,node.body);ctx.emit('}');normal(ctx);
}
function forOfStatement(ctx,node){
 if(node.await)unsupported(node,'async iteration is not implemented');
 if(node.left.type==='VariableDeclaration')declarationKind(node.left);
 let head=ctx;
 if(node.left.type==='VariableDeclaration'&&node.left.kind!=='var'){const env=ctx.temp(`rt.child_block_env(${ctx.env})`);head=child(ctx,{env});declareLexicals(head,[node.left]);}
 const iterable=head.expression(node.right),iterator=ctx.fresh('for_of_iterator');ctx.emit(`let mut ${iterator} = rt.iterator(${iterable})?;`);
 ctx.emit('loop {');const value=ctx.fresh('iteration_value');
 // An abrupt next()/value read is NOT IteratorClosed by ForIn/OfBodyEvaluation.
 ctx.emit(`let Some(${value}) = rt.iterator_next(&mut ${iterator})? else { break; };`);
 const result=capture(ctx,()=>{
  let local=ctx;
  if(node.left.type==='VariableDeclaration'){
   if(node.left.declarations.length!==1)unsupported(node.left,'for-of requires exactly one declaration');
   const declaration=node.left.declarations[0];if(declaration.init)unsupported(declaration,'initialized for-of binding is invalid');
   if(node.left.kind!=='var'){const env=ctx.temp(`rt.child_block_env(${ctx.env})`);local=child(ctx,{env});declareLexicals(local,[node.left]);}
   bindPattern(local,declaration.id,value,node.left.kind);
  }else{const reference=emitReference(node.left,ctx);writeReference(reference,value,ctx);}
  const completion=emitStatement(node.body,child(local,{pendingLabels:[]}));ctx.emit(`Ok(${completion})`);
 });
 const target=ctx.fresh('continue_label');ctx.emit(`match ${result} {`);
 ctx.emit('Ok(Completion::Normal) | Ok(Completion::Continue(None)) => {},');
 ctx.emit(`Ok(Completion::Continue(${target})) if ${handlesLabel(ctx,target)} => {},`);
 const abrupt=ctx.fresh('iterator_abrupt');ctx.emit(`${abrupt} => {`);
 const closed=ctx.temp(`rt.iterator_close(&mut ${iterator}, ${abrupt})?`),label=ctx.fresh('break_label');ctx.emit(`match ${closed} {`);
 ctx.emit('Completion::Break(None) => break,');ctx.emit(`Completion::Break(${label}) if ${handlesLabel(ctx,label)} => break,`);ctx.emit('other => return Ok(other),');ctx.emit('}');ctx.emit('}');ctx.emit('}');ctx.emit('}');normal(ctx);
}
function switchStatement(ctx,node){
 const discriminant=ctx.expression(node.discriminant),env=ctx.temp(`rt.child_block_env(${ctx.env})`),local=child(ctx,{env,pendingLabels:[]});
 const statements=node.cases.flatMap(entry=>entry.consequent);declareLexicals(local,statements);instantiateFunctions(ctx,local,statements,env);
 const selected=ctx.fresh('switch_case');ctx.emit(`let mut ${selected}: Option<usize> = None;`);let fallback=null;
 node.cases.forEach((entry,index)=>{if(!entry.test){fallback=index;return;}ctx.emit(`if ${selected}.is_none() {`);const value=local.expression(entry.test),equal=local.temp(`rt.binary(BinaryOp::StrictEq, ${discriminant}, ${value})?`);ctx.emit(`if rt.truthy(${equal}) { ${selected} = Some(${index}); }`);ctx.emit('}');});
 if(fallback!==null)ctx.emit(`if ${selected}.is_none() { ${selected} = Some(${fallback}); }`);
 const start=ctx.fresh('switch_start');ctx.emit(`if let Some(${start}) = ${selected} {`);
 node.cases.forEach((entry,index)=>{ctx.emit(`if ${start} <= ${index} {`);const completion=emitStatements(entry.consequent,local);ctx.emit(`match ${completion} { Completion::Normal => {}, Completion::Break(None) => return Ok(Completion::Normal), other => return Ok(other) }`);ctx.emit('}');});ctx.emit('}');normal(ctx);
}
function tryStatement(ctx,node){
 let prior=capture(ctx,()=>{const completion=emitStatement(node.block,child(ctx,{pendingLabels:[]}));ctx.emit(`Ok(${completion})`);});
 if(node.handler){
  const result=ctx.fresh('catch_result'),error=ctx.fresh('caught_error');ctx.emit(`let ${result}: JsResult<Completion> = match ${prior} { Ok(value) => Ok(value), Err(${error}) => {`);
  const caught=capture(ctx,()=>{
   const env=ctx.temp(`rt.child_block_env(${ctx.env})`),local=child(ctx,{env,pendingLabels:[]});
   if(node.handler.param){const value=ctx.temp(`rt.error_value(${error})?`);for(const name of boundNames(node.handler.param))ctx.emit(`rt.declare_lexical(${env}, ${quote(name)}, true)?;`);bindPattern(local,node.handler.param,value,'catch');}else ctx.emit(`if matches!(${error}, JsError::Unsupported(_)) { return Err(${error}); }`);
   const completion=emitStatement(node.handler.body,local);ctx.emit(`Ok(${completion})`);
  });ctx.emit(caught);ctx.emit('} };');prior=result;
 }
 // Internal unsupported runtime features are not source throws and cannot be
 // hidden by a catch or by a finally return.
 ctx.emit(`if let Err(error @ JsError::Unsupported(_)) = ${prior} { return Err(error); }`);
 if(node.finalizer){const final=capture(ctx,()=>{const completion=emitStatement(node.finalizer,child(ctx,{pendingLabels:[]}));ctx.emit(`Ok(${completion})`);});ctx.emit(`match ${final} { Ok(Completion::Normal) => ${prior}, other => other }`);}else ctx.emit(prior);
}

/** Return a Rust Completion temporary. Surrounding generated code returns JsResult<Completion>. */
export function emitStatement(node,ctx){
 if(!node)unsupported(node,'missing statement');
 const result=capture(ctx,()=>{
  switch(node.type){
   case 'EmptyStatement':normal(ctx);break;
   case 'ExpressionStatement':ctx.expression(node.expression);normal(ctx);break;
   case 'BlockStatement':block(ctx,node);break;
   case 'VariableDeclaration':declaration(ctx,node);break;
   case 'FunctionDeclaration':{if(ctx.annexBDeclarations?.has(node)){const value=ctx.temp(`rt.lookup(${ctx.env}, ${quote(node.id.name)})?`);ctx.emit(`rt.assign(${ctx.functionEnv??ctx.env}, ${quote(node.id.name)}, ${value}, false)?;`);}normal(ctx);break;} // Lexical instantiation precedes execution; Annex B's outer alias does not.
   case 'ReturnStatement':{const value=node.argument?ctx.expression(node.argument):'Value::Undefined';ctx.emit(`Ok(Completion::Return(${value}))`);break;}
   case 'ThrowStatement':{const value=ctx.expression(node.argument);ctx.emit(`Err(JsError::Throw(${value}))`);break;}
   case 'BreakStatement':ctx.emit(`Ok(Completion::Break(${node.label?`Some(${quote(node.label.name)})`:'None'}))`);break;
   case 'ContinueStatement':ctx.emit(`Ok(Completion::Continue(${node.label?`Some(${quote(node.label.name)})`:'None'}))`);break;
   case 'IfStatement':{if(node.consequent.type==='FunctionDeclaration'||node.alternate?.type==='FunctionDeclaration')unsupported(node,'conditional function declaration requires Annex B instantiation');const condition=ctx.expression(node.test);ctx.emit(`if rt.truthy(${condition}) {`);const yes=emitStatement(node.consequent,child(ctx,{pendingLabels:[]}));ctx.emit(`Ok(${yes})`);ctx.emit('} else {');if(node.alternate){const no=emitStatement(node.alternate,child(ctx,{pendingLabels:[]}));ctx.emit(`Ok(${no})`);}else normal(ctx);ctx.emit('}');break;}
   case 'WhileStatement':ctx.emit('loop {');{const condition=ctx.expression(node.test);ctx.emit(`if !rt.truthy(${condition}) { break; }`);}loopBody(ctx,node.body);ctx.emit('}');normal(ctx);break;
   case 'DoWhileStatement':ctx.emit('loop {');loopBody(ctx,node.body,()=>{const condition=ctx.expression(node.test);ctx.emit(`if !rt.truthy(${condition}) { break; }`);});ctx.emit('}');normal(ctx);break;
   case 'ForStatement':forStatement(ctx,node);break;
   case 'ForInStatement':forInStatement(ctx,node);break;
   case 'ForOfStatement':forOfStatement(ctx,node);break;
   case 'SwitchStatement':switchStatement(ctx,node);break;
   case 'TryStatement':tryStatement(ctx,node);break;
   case 'LabeledStatement':{if(node.body.type==='FunctionDeclaration')unsupported(node,'labeled function declaration requires Annex B instantiation');const label=node.label.name,completion=emitStatement(node.body,child(ctx,{pendingLabels:[...labels(ctx),label]}));ctx.emit(`match ${completion} { Completion::Break(Some(${quote(label)})) => Ok(Completion::Normal), other => Ok(other) }`);break;}
   default:unsupported(node,'statement lowering is not implemented');
  }
 });
 return ctx.temp(`${result}?`);
}

/** Lower a statement list in an already-instantiated lexical environment. */
export function emitStatements(nodes,ctx){
 const result=capture(ctx,()=>{for(const node of nodes){const completion=emitStatement(node,ctx);propagate(ctx,completion);}normal(ctx);});
 return ctx.temp(`${result}?`);
}
