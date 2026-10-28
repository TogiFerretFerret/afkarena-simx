import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {parse,parseExpression} from '@babel/parser';
import {emitExpression} from './expressions.mjs';
import {emitStatements} from './statements.mjs';

const FUNCTION_TYPES=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
const sha=text=>createHash('sha256').update(text).digest('hex');
export function rustString(text){let result='"';for(const character of text){const code=character.codePointAt(0);if(character==='"')result+='\\"';else if(character==='\\')result+='\\\\';else if(code>=32&&code<127)result+=character;else if(code<0xd800||code>0xdfff)result+='\\u{'+code.toString(16)+'}';else throw Error('A Rust identifier/metadata string cannot contain an unpaired surrogate');}return result+'"';}
const utf16=text=>Array.from({length:text.length},(_,i)=>text.charCodeAt(i));
const childNodes=node=>Object.entries(node).flatMap(([key,value])=>key==='loc'||key==='extra'||key==='comments'||key==='tokens'?[]:Array.isArray(value)?value.filter(x=>x&&typeof x.type==='string'):value&&typeof value.type==='string'?[value]:[]);
function bindings(pattern){if(pattern.type==='Identifier')return[pattern.name];if(pattern.type==='RestElement')return bindings(pattern.argument);if(pattern.type==='AssignmentPattern')return bindings(pattern.left);if(pattern.type==='ArrayPattern')return pattern.elements.flatMap(x=>x?bindings(x):[]);if(pattern.type==='ObjectPattern')return pattern.properties.flatMap(x=>bindings(x.type==='RestElement'?x.argument:x.value));throw Error('Unsupported binding pattern '+pattern.type);}
function directBody(node){if(node.type==='Program')return node.body;if(node.body.type==='BlockStatement')return node.body.body;return null;}
function strictDirective(node){return(node.directives??node.body?.directives??[]).some(row=>row.value.value==='use strict');}
function lexicalDeclarations(body){return body.flatMap(node=>node.type==='VariableDeclaration'&&node.kind!=='var'?node.declarations.flatMap(d=>bindings(d.id).map(name=>({name,mutable:node.kind==='let'}))):[]);}
function hoists(node){const names=new Set(),functions=[];const body=directBody(node)??[];for(const entry of body)if(entry.type==='FunctionDeclaration'){if(!entry.id)throw Error('Anonymous function declaration');names.add(entry.id.name);functions.push(entry);}
 const walk=current=>{if(FUNCTION_TYPES.has(current.type))return;if(current.type==='VariableDeclaration'&&current.kind==='var')for(const declaration of current.declarations)for(const name of bindings(declaration.id))names.add(name);for(const child of childNodes(current))walk(child);};for(const entry of body)walk(entry);return{names:[...names],functions};}
function diagnostic(error,node,filename){return{filename,start:node.start??0,end:node.end??0,line:node.loc?.start.line??null,column:node.loc?.start.column??null,nodeType:node.type,reason:error.message??String(error)};}

/** Babel AST -> native Rust execution functions. Unsupported bodies are explicit
 * hard-failure stubs, listed in the manifest; no JavaScript backend is emitted. */
export function compileSource(source,{filename='input.js',mode='script',moduleName='generated',allowUnsupported=true}={}){
 const root=mode==='function'?parseExpression(source,{sourceType:'script'}):parse(source,{sourceType:mode==='module'?'module':'script',allowReturnOutsideFunction:false}).program;
 if(mode==='function'&&!FUNCTION_TYPES.has(root.type))throw Error('--function input must be a function expression');
 const parents=new WeakMap(),records=[],recordByNode=new WeakMap(),inventory={};
 function collect(node,parent,inheritedStrict){parents.set(node,parent);inventory[node.type]=(inventory[node.type]??0)+1;const isFunction=FUNCTION_TYPES.has(node.type);let strict=inheritedStrict;
  if(node.type==='Program'||isFunction){strict=inheritedStrict||strictDirective(node)||node.type==='ClassMethod'||node.type==='ClassPrivateMethod';const record={node,id:records.length,strict,diagnostics:[]};records.push(record);recordByNode.set(node,record);}
  for(const child of childNodes(node))collect(child,node,strict);
 }
 collect(root,null,mode==='module');
 const compiled=[];
 const inferName=node=>{if(node.id)return node.id.name;const parent=parents.get(node);if(parent?.type==='VariableDeclarator'&&parent.init===node&&parent.id.type==='Identifier')return parent.id.name;if(parent?.type==='AssignmentExpression'&&parent.right===node&&parent.left.type==='Identifier')return parent.left.name;return'';};
 function closure(node,ctx,options={}){
  const record=recordByNode.get(node);if(!record)throw Error('Internal missing function registry for '+node.type);
  const name=node.id?.name??options.inferredName??inferName(node),arity=node.params.length;
  let rhs;
  if(node.type==='FunctionExpression'&&node.id)rhs=`rt.make_named_closure(js_function_${record.id}, ${ctx.env}, ${arity}, ${rustString(name)}, ${record.strict})`;
  else rhs=`rt.make_closure_with_flags(js_function_${record.id}, ${ctx.env}, ${arity}, ${rustString(name)}, ${record.strict}, ${node.type==='ArrowFunctionExpression'?`Some(${ctx.thisValue})`:'None'})`;
  const value=ctx.temp(rhs);if(node.type==='ObjectMethod')ctx.emit(`rt.set_function_constructable(${value}, false)?;`);ctx.emit(`rt.set_function_source(${value}, &[${utf16(source.slice(node.start,node.end)).join(',')}])?;`);return value;
 }
 function context(record){const lines=[],state={counter:0};
  const ctx={env:'env',functionEnv:'env',thisValue:'this',strict:record.strict,pendingLabels:[],emit(line){lines.push(line);},fresh(prefix='temporary'){return prefix.replace(/[^A-Za-z0-9_]/g,'_')+'_'+state.counter++;},temp(rhs){const name=this.fresh('value');this.emit(`let ${name} = ${rhs};`);return name;},expression(node){return emitExpression(node,this);},makeClosure(node,options){return closure(node,this,options);},child(overrides={}){return Object.assign(Object.create(this),overrides);},rustString,unsupported(node,reason){const error=Error(reason);error.node=node;throw error;}};
  return{ctx,lines};
 }
 for(const record of records){const{node,id,strict}=record,{ctx,lines}=context(record);let supported=true;
  try{
   if(node.async||node.generator)ctx.unsupported(node,'Async/generator execution is not implemented');
   if(node.type==='ClassMethod'||node.type==='ClassPrivateMethod')ctx.unsupported(node,'Class home-object/super semantics are not implemented');
   for(const parameter of node.params??[])if(parameter.type!=='Identifier')ctx.unsupported(parameter,'Non-simple parameter initialization and TDZ are not implemented');
   if(node.type==='Program')ctx.emit('let env = parent;');else ctx.emit('let env = rt.child_env(parent);');
   const body=directBody(node),declarations=hoists(node),params=node.params??[];
   for(let index=0;index<params.length;index++){const name=rustString(params[index].name);ctx.emit(`rt.declare(env, ${name}, Value::Undefined)?;`);ctx.emit(`rt.assign(env, ${name}, args.get(${index}).copied().unwrap_or(Value::Undefined), false)?;`);}
   if(node.type!=='Program'&&node.type!=='ArrowFunctionExpression'&&!params.some(p=>p.name==='arguments')){const argsValue=ctx.temp(`rt.arguments_object(env, &[${params.map(p=>rustString(p.name)).join(',')}], args, ${strict})?`);ctx.emit(`rt.declare(env, "arguments", ${argsValue})?;`);}
   for(const name of declarations.names)ctx.emit(`rt.declare(env, ${rustString(name)}, Value::Undefined)?;`);
   if(body){for(const binding of lexicalDeclarations(body))ctx.emit(`rt.declare_lexical(env, ${rustString(binding.name)}, ${binding.mutable})?;`);
    for(const fn of declarations.functions){const value=ctx.makeClosure(fn);ctx.emit(`rt.assign(env, ${rustString(fn.id.name)}, ${value}, false)?;`);}
    const completion=emitStatements(body,ctx);ctx.emit(`match ${completion} { Completion::Normal => Ok(Value::Undefined), Completion::Return(value) => Ok(value), _ => unreachable!("Babel accepted an invalid function completion") }`);
   }else{const value=ctx.expression(node.body);ctx.emit(`Ok(${value})`);}
  }catch(error){supported=false;record.diagnostics.push(diagnostic(error,error.node??node,filename));}
  record.supported=supported;
  const contents=supported?lines.join('\n'): `Err(JsError::Unsupported(${rustString(record.diagnostics[0].reason)}.into()))`;
  compiled.push(`pub fn js_function_${id}(rt: &mut Runtime, this: Value, args: &[Value], parent: EnvId) -> JsResult<Value> {\n${contents}\n}`);
 }
 const first=records[0],entry=mode==='function'?(()=>{const{ctx,lines}=context(first);ctx.env='parent';ctx.thisValue='Value::Undefined';const value=ctx.makeClosure(root);ctx.emit(`Ok(${value})`);return`pub fn create_function(rt: &mut Runtime, parent: EnvId) -> JsResult<Value> {\n${lines.join('\n')}\n}`;})():`pub fn run(rt: &mut Runtime, env: EnvId, this: Value) -> JsResult<Value> { js_function_0(rt, this, &[], env) }`;
 const diagnostics=records.flatMap(record=>record.diagnostics),manifest={version:1,moduleName,filename,mode,sourceSha256:sha(source),sourceUtf16Length:source.length,astNodes:Object.values(inventory).reduce((a,b)=>a+b,0),astNodeTypes:inventory,functions:records.map(({node,id,strict,supported,diagnostics})=>({id,name:node.id?.name??inferName(node),start:node.start,end:node.end,line:node.loc?.start.line,column:node.loc?.start.column,strict,supported,sourceSha256:sha(source.slice(node.start,node.end)),diagnostics})),compiledFunctions:records.filter(r=>r.supported).length,unsupportedFunctions:records.filter(r=>!r.supported).length,complete:diagnostics.length===0,diagnostics,semanticallyQualified:false,executionBackend:'Generated Rust with native js-runtime; no JS interpreter or engine fallback.',qualification:'Compile coverage is not semantic qualification. Unsupported bodies raise uncatchable internal Unsupported errors. Differential evidence must be recorded separately.'};
 if(!allowUnsupported&&!manifest.complete){const error=Error('Unsupported syntax: '+diagnostics.map(d=>`${d.filename}:${d.line}:${d.column}: ${d.reason}`).join('\n'));error.manifest=manifest;throw error;}
 const rust=`// Generated by tools/rust-port/compile.mjs; source SHA-256 ${manifest.sourceSha256}\n#![allow(unused_imports,unused_variables,unused_mut,dead_code,unreachable_patterns)]\nuse js_runtime::{Runtime,Value,EnvId,JsResult,JsError,Completion,BinaryOp,UnaryOp};\n${compiled.join('\n\n')}\n\n${entry}\n`;
 return{rust,manifest};
}

async function main(){const input=process.argv[2];if(!input||input.startsWith('--'))throw Error('Usage: node tools/rust-port/compile.mjs INPUT.js --out OUTPUT.rs [--function] [--reject-unsupported]');const at=process.argv.indexOf('--out');if(at<0)throw Error('--out is required');const output=resolve(process.argv[at+1]),source=await readFile(resolve(input),'utf8'),result=compileSource(source,{filename:input,mode:process.argv.includes('--function')?'function':'script'});await mkdir(dirname(output),{recursive:true});await writeFile(output,result.rust);await writeFile(output+'.manifest.json',JSON.stringify(result.manifest,null,2)+'\n');console.log(JSON.stringify({output,compiledFunctions:result.manifest.compiledFunctions,unsupportedFunctions:result.manifest.unsupportedFunctions,complete:result.manifest.complete}));if(process.argv.includes('--reject-unsupported')&&!result.manifest.complete)process.exitCode=1;}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))await main();
