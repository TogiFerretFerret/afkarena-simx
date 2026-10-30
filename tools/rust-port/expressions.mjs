import {createContext,Script} from 'node:vm';
import {readFileSync} from 'node:fs';
const numericFoldOperators=new Set(['+','-','*','/','%','**','<<','>>','>>>','|','^','&']);
const numericFoldCache=new Map();let numericFoldRealm=null;
// V8 folds literal numeric subtrees in its parser. Invalid literal arithmetic
// can therefore have DIFFERENT NaN bits from dynamic arithmetic. This compiler
// folds only a reconstructed literal/operator whitelist, never user statements,
// names, calls, property reads or arbitrary source text.
function numericFoldSource(node){
 node=unwrap(node);
 if(node?.type==='NumericLiteral'){
  const raw=node.extra?.raw;
  if(typeof raw==='string'&&/^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9_]+)(?:[eE][+-]?[0-9_]+)?)$/.test(raw))return raw;
  if(Number.isFinite(node.value))return Object.is(node.value,-0)?'(-0)':String(node.value);
  if(node.value===Infinity)return '1e999';
  if(node.value===-Infinity)return '(-1e999)';
  return null;
 }
 if(node?.type==='UnaryExpression'&&['+','-','~'].includes(node.operator)){const value=numericFoldSource(node.argument);return value===null?null:'('+node.operator+'('+value+'))';}
 if(node?.type==='BinaryExpression'&&numericFoldOperators.has(node.operator)){const left=numericFoldSource(node.left),right=numericFoldSource(node.right);return left===null||right===null?null:'(('+left+')'+node.operator+'('+right+'))';}
 return null;
}
function foldNumeric(node,ctx){
 if(!['BinaryExpression','UnaryExpression'].includes(node.type))return null;
 const source=numericFoldSource(node);if(source===null)return null;
 if(!numericFoldRealm){const profile=JSON.parse(readFileSync(new URL('../../config/source-oracle-runtime.json',import.meta.url),'utf8'));if(process.version!==profile.node||process.versions.v8!==profile.v8)throw Error('Numeric source folding requires the pinned Node/V8 compiler host');numericFoldRealm=createContext(Object.create(null));}
 let bits=numericFoldCache.get(source);if(bits===undefined){const number=new Script(source).runInContext(numericFoldRealm);if(typeof number!=='number')throw Error('Numeric fold whitelist produced a non-Number');const buffer=new ArrayBuffer(8),view=new DataView(buffer);view.setFloat64(0,number,false);bits=view.getBigUint64(0,false).toString(16).padStart(16,'0');numericFoldCache.set(source,bits);}
 return ctx.temp(`Value::Number(f64::from_bits(0x${bits}u64))`);
}
// Expressions emit ordered Rust temporaries; the JS oracle is never a fallback.
// A property Reference stores a RAW key Value. GetValue and PutValue each perform
// their own coercion: o[key]+=rhs coerces key BEFORE rhs and AGAIN on the write.
const binaryOps={'+':'Add','-':'Sub','*':'Mul','/':'Div','%':'Rem','**':'Pow','<<':'Shl','>>':'Shr','>>>':'UShr','|':'BitOr','^':'BitXor','&':'BitAnd','==':'Eq','!=':'Ne','===':'StrictEq','!==':'StrictNe','<':'Lt','<=':'Le','>':'Gt','>=':'Ge','in':'In','instanceof':'InstanceOf'};
const unaryOps={'+':'Plus','-':'Minus','!':'Not','~':'BitNot','typeof':'TypeOf','void':'Void'};
export function unsupportedExpression(node,reason){const loc=node?.loc?.start;const error=new Error(`Unsupported ${node?.type??'expression'}${loc?` at ${loc.line}:${loc.column}`:''}: ${reason}`);error.node=node;throw error;}
export function rustString(text){let out='"';for(const character of String(text)){const cp=character.codePointAt(0);if(character==='"')out+='\\"';else if(character==='\\')out+='\\\\';else if(character==='\n')out+='\\n';else if(character==='\r')out+='\\r';else if(character==='\t')out+='\\t';else if(cp<32||cp===127)out+='\\u{'+cp.toString(16)+'}';else if(cp>=0xd800&&cp<=0xdfff)throw Error('A Rust UTF-8 metadata string cannot contain a lone surrogate');else out+=character;}return out+'"';}
const quote=(ctx,text)=>ctx.rustString?ctx.rustString(text):rustString(text);
function stringValue(ctx,text){const s=String(text);
 // Runtime::new reserves these canonical IDs before any user strings.
 if(ctx.staticLiteralStrings!==false&&s.length===1&&s>='0'&&s<='3')return ctx.temp(`Value::String(js_runtime::StringId(${s}))`);
for(let i=0;i<s.length;i++){const n=s.charCodeAt(i);if(n>=0xd800&&n<=0xdfff){if(n<=0xdbff&&i+1<s.length&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){i++;continue;}return ctx.temp(`rt.${ctx.staticLiteralStrings===false?'string_utf16':'static_string_utf16'}(&[${Array.from({length:s.length},(_,j)=>s.charCodeAt(j)+'u16').join(',')}])`);}}return ctx.temp(`rt.${ctx.staticLiteralStrings===false?'string':'static_string'}(${rustString(s)})`);}
// Abstract ToPropertyKey on an actual numeric literal is pure; Number.prototype
// hooks are never consulted. Keep all dynamic expressions on the ordinary path.
let numericKeyProfileChecked=false;
function computedMemberKey(node,ctx){
 const literal=unwrap(node);let number;
 if(literal?.type==='NumericLiteral')number=literal.value;
 else if(literal?.type==='UnaryExpression'&&['+','-'].includes(literal.operator)&&unwrap(literal.argument)?.type==='NumericLiteral'){
  number=unwrap(literal.argument).value;if(literal.operator==='-')number=-number;
 }else return emitExpression(node,ctx);
 if(ctx.numericLiteralKeys===false)return emitExpression(node,ctx);
 if(!numericKeyProfileChecked){const profile=JSON.parse(readFileSync(new URL('../../config/source-oracle-runtime.json',import.meta.url),'utf8'));
 if(process.version!==profile.node||process.versions.v8!==profile.v8)throw Error('Numeric literal keys require the pinned Node/V8 compiler host');numericKeyProfileChecked=true;}
 return stringValue(ctx,String(number));
}
function numberValue(ctx,value){const b=new ArrayBuffer(8),v=new DataView(b);v.setFloat64(0,value,false);return ctx.temp(`Value::Number(f64::from_bits(0x${v.getBigUint64(0,false).toString(16).padStart(16,'0')}u64))`);}
function unwrap(node){while(node?.type==='ParenthesizedExpression')node=node.expression;return node;}
function isReference(node){node=unwrap(node);return node?.type==='Identifier'||node?.type==='MemberExpression';}
export function emitReference(node,ctx){node=unwrap(node);if(node?.type==='Identifier'){const local=typeof ctx.nativeLocal==='function'?ctx.nativeLocal(node.name,node):null;if(local)return{kind:'binding',local,name:node.name};const known=typeof ctx.knownBinding==='function'?ctx.knownBinding(node.name,node):null;return{kind:'binding',binding:known??ctx.temp(`${typeof ctx.envCall==='function'?ctx.envCall("resolve_binding",ctx.env,node.name):`rt.resolve_binding(${ctx.env}, ${quote(ctx,node.name)})`}?`),name:node.name};}if(node?.type==='MemberExpression'){if(node.object.type==='Super'||node.property.type==='PrivateName')unsupportedExpression(node,'super/private references are not implemented');const base=emitExpression(node.object,ctx);if(!node.computed&&ctx.literalPropertySlots)return{kind:'property',base,key:null,literalKey:node.property.name};const key=node.computed?computedMemberKey(node.property,ctx):stringValue(ctx,node.property.name);return{kind:'property',base,key};}unsupportedExpression(node,'expression is not an assignable Reference');}
function referenceKey(ref,ctx){if(ref.key===null)ref.key=stringValue(ctx,ref.literalKey);return ref.key;}
export function readReference(ref,ctx){if(ref.local)return ctx.temp(ref.local);if(ref.kind==='binding')return ctx.temp(`rt.read_binding(${ref.binding})?`);if(ref.kind==='property'){if(ref.literalKey!==undefined){const site=ctx.fresh('LITERAL_READ_SITE').toUpperCase();ctx.emit(`static ${site}: js_runtime::property_slots::LiteralReadSite = js_runtime::property_slots::LiteralReadSite::${ctx.prototypeLiteralHints?'new_with_prototype_hint':'new'}(${rustString(ref.literalKey)}${ctx.prototypeLiteralHints?', true':''});`);return ctx.temp(`rt.${ctx.prototypeLiteralHints?'get_literal_cached_with_prototype_hint':'get_literal_cached'}(${ref.base}, &${site})?`);}return ctx.temp(`rt.get(${ref.base}, ${ref.key})?`);}throw Error('Unknown Reference kind');}
export function writeReference(ref,value,ctx){if(ref.local){ctx.emit(`${ref.local} = ${value};`);return ctx.temp(ref.local);}if(ref.kind==='binding')return ctx.temp(`rt.write_binding(${ref.binding}, ${value}, ${ctx.strict?'true':'false'})?`);if(ref.kind==='property')return ctx.temp(`rt.set(${ref.base}, ${referenceKey(ref,ctx)}, ${value}, ${ctx.strict?'true':'false'})?`);throw Error('Unknown Reference kind');}
function closure(node,ctx,inferredName){if(typeof ctx.makeClosure!=='function')throw Error('Expression context requires makeClosure');return ctx.makeClosure(node,inferredName===undefined?{}:{inferredName});}
function anonymous(node){node=unwrap(node);return(node?.type==='FunctionExpression'&&!node.id)||node?.type==='ArrowFunctionExpression';}
const numericArithmetic={Add:'add',Sub:'sub',Mul:'mul',Div:'div'};
const numericComparison={Lt:'<',Le:'<=',Gt:'>',Ge:'>=',Eq:'==',Ne:'!=',StrictEq:'==',StrictNe:'!='};
function binaryValue(name,left,right,ctx){
 const fallback=`rt.binary(BinaryOp::${name}, ${left}, ${right})?`;
 if(ctx.nativeNumericOps===false||(!numericArithmetic[name]&&!numericComparison[name]))return ctx.temp(fallback);
 const a=ctx.fresh('numeric_left'),b=ctx.fresh('numeric_right');
 const result=numericArithmetic[name]?`Value::Number(js_runtime::numeric_arithmetic::${numericArithmetic[name]}(${a}, ${b}))`:`Value::Bool(${a} ${numericComparison[name]} ${b})`;
 return ctx.temp(`match (${left}, ${right}) { (Value::Number(${a}), Value::Number(${b})) => ${result}, _ => ${fallback} }`);
}
function assignment(node,ctx){const ref=emitReference(node.left,ctx),op=node.operator;if(op==='='){const value=anonymous(node.right)&&ref.kind==='binding'?closure(node.right,ctx,ref.name):emitExpression(node.right,ctx);writeReference(ref,value,ctx);return value;}const old=readReference(ref,ctx);if(['&&=','||=','??='].includes(op)){const result=ctx.fresh('assigned');ctx.emit(`let mut ${result} = ${old};`);const condition=op==='&&='?`rt.truthy(${old})`:op==='||='?`!rt.truthy(${old})`:`matches!(${old}, Value::Null | Value::Undefined)`;ctx.emit(`if ${condition} {`);const value=anonymous(node.right)&&ref.kind==='binding'?closure(node.right,ctx,ref.name):emitExpression(node.right,ctx);writeReference(ref,value,ctx);ctx.emit(`${result} = ${value};`);ctx.emit('}');return result;}const name=binaryOps[op.slice(0,-1)];if(!name)unsupportedExpression(node,'unknown assignment operator '+op);const right=emitExpression(node.right,ctx),value=binaryValue(name,old,right,ctx);writeReference(ref,value,ctx);return value;}
function update(node,ctx){const ref=emitReference(node.argument,ctx),raw=readReference(ref,ctx),numeric=ctx.temp(`rt.to_number(${raw})?`),old=ctx.temp(`Value::Number(${numeric})`),one=numberValue(ctx,1),value=binaryValue(node.operator==='++'?'Add':'Sub',old,one,ctx);if(!['++','--'].includes(node.operator))unsupportedExpression(node,'unknown update operator');writeReference(ref,value,ctx);return node.prefix?value:old;}
function logical(node,ctx){const left=emitExpression(node.left,ctx),result=ctx.fresh('logical');ctx.emit(`let mut ${result} = ${left};`);const condition=node.operator==='&&'?`rt.truthy(${left})`:node.operator==='||'?`!rt.truthy(${left})`:node.operator==='??'?`matches!(${left}, Value::Null | Value::Undefined)`:null;if(!condition)unsupportedExpression(node,'unknown logical operator');ctx.emit(`if ${condition} {`);const right=emitExpression(node.right,ctx);ctx.emit(`${result} = ${right};`);ctx.emit('}');return result;}
function argumentsList(arguments_,ctx){if(!arguments_.some(arg=>arg.type==='SpreadElement')){const values=arguments_.map(arg=>emitExpression(arg,ctx));return '&['+values.join(',')+']';}const vector=ctx.fresh('arguments');ctx.emit(`let mut ${vector}: Vec<Value> = Vec::new();`);for(const arg of arguments_){if(arg.type==='SpreadElement'){const value=emitExpression(arg.argument,ctx),expanded=ctx.temp(`rt.argument_spread(${value})?`);ctx.emit(`${vector}.extend(${expanded});`);}else{const value=emitExpression(arg,ctx);ctx.emit(`${vector}.push(${value});`);}}return '&'+vector;}
function chainBoundary(node){return node?.type==='ParenthesizedExpression'||node?.extra?.parenthesized;}
function optionalNode(node){return ['OptionalMemberExpression','OptionalCallExpression'].includes(unwrap(node)?.type);}
function calleeResult(node,ctx){node=unwrap(node);if(optionalNode(node))return optionalResult(node,ctx);if(isReference(node)){const ref=emitReference(node,ctx);return{value:readReference(ref,ctx),receiver:ref.kind==='property'?ref.base:'Value::Undefined',short:'false'};}return{value:emitExpression(node,ctx),receiver:'Value::Undefined',short:'false'};}
function optionalResult(node,ctx,{deleteLast=false}={}){
 node=unwrap(node);
 if(node.type==='OptionalMemberExpression'){
  if(node.object.type==='Super'||node.property.type==='PrivateName')unsupportedExpression(node,'super/private optional access is not implemented');
  const object=optionalNode(node.object)&&!chainBoundary(node.object)?optionalResult(node.object,ctx):{value:emitExpression(node.object,ctx),short:'false'};
  const value=ctx.fresh('optional_value'),receiver=ctx.fresh('optional_receiver'),short=ctx.fresh('optional_short');ctx.emit(`let mut ${value} = ${deleteLast?'Value::Bool(true)':'Value::Undefined'};`);ctx.emit(`let mut ${receiver} = Value::Undefined;`);ctx.emit(`let mut ${short} = ${object.short};`);ctx.emit(`if !${short} {`);
  if(node.optional){ctx.emit(`if matches!(${object.value}, Value::Null | Value::Undefined) { ${short} = true; } else {`);}
  const key=node.computed?computedMemberKey(node.property,ctx):stringValue(ctx,node.property.name);
  if(deleteLast){const deleted=ctx.temp(`rt.delete(${object.value}, ${key}, ${ctx.strict?'true':'false'})?`);ctx.emit(`${value} = Value::Bool(${deleted});`);}else{const read=ctx.temp(`rt.get(${object.value}, ${key})?`);ctx.emit(`${value} = ${read};`);ctx.emit(`${receiver} = ${object.value};`);}
  if(node.optional)ctx.emit('}');ctx.emit('}');return{value,receiver,short};
 }
 if(node.type==='OptionalCallExpression'){
  const callee=calleeResult(node.callee,ctx),value=ctx.fresh('optional_call'),short=ctx.fresh('optional_short');ctx.emit(`let mut ${value} = Value::Undefined;`);ctx.emit(`let mut ${short} = ${chainBoundary(node.callee)?'false':callee.short};`);ctx.emit(`if !${short} {`);
  if(node.optional)ctx.emit(`if matches!(${callee.value}, Value::Null | Value::Undefined) { ${short} = true; } else {`);
  const args=argumentsList(node.arguments,ctx),called=ctx.temp(`rt.call(${callee.value}, ${callee.receiver}, ${args})?`);ctx.emit(`${value} = ${called};`);if(node.optional)ctx.emit('}');ctx.emit('}');return{value,receiver:'Value::Undefined',short};
 }
 unsupportedExpression(node,'invalid optional chain node');
}
function call(node,ctx,construct=false){let callee,receiver;if(construct){callee=emitExpression(node.callee,ctx);receiver='Value::Undefined';}else{const result=calleeResult(node.callee,ctx);callee=result.value;receiver=result.receiver;}const args=argumentsList(node.arguments,ctx);return ctx.temp(construct?`rt.construct(${callee}, ${args})?`:`rt.call(${callee}, ${receiver}, ${args})?`);}

function object(node,ctx){const value=ctx.temp('rt.object()');for(const prop of node.properties){if(prop.type==='SpreadElement'){const source=emitExpression(prop.argument,ctx);ctx.emit(`rt.copy_data_properties(${value}, ${source})?;`);continue;}if(!['ObjectProperty','ObjectMethod'].includes(prop.type))unsupportedExpression(prop,'unsupported object property');if(prop.decorators?.length)unsupportedExpression(prop,'decorated properties are not implemented');let key;if(prop.computed){const raw=emitExpression(prop.key,ctx);key=ctx.temp(`rt.to_property_key(${raw})?`);}else if(prop.key.type==='Identifier')key=stringValue(ctx,prop.key.name);else if(['StringLiteral','NumericLiteral'].includes(prop.key.type))key=stringValue(ctx,prop.key.value);else unsupportedExpression(prop.key,'unsupported literal property key');
 const nameKey=prop.computed?ctx.temp(`Value::String(${key}.0)`):key;
 const staticName=!prop.computed?(prop.key.name??String(prop.key.value)):undefined;
 const data=prop.type==='ObjectMethod'?closure(prop,ctx,staticName):anonymous(prop.value)?closure(prop.value,ctx,prop.type==='ObjectProperty'&&!prop.computed&&!prop.shorthand&&staticName==='__proto__'?'':staticName):emitExpression(prop.value,ctx);
 if(prop.type==='ObjectProperty'&&!prop.computed&&!prop.shorthand&&staticName==='__proto__'){ctx.emit(`if matches!(${data}, Value::Object(_) | Value::Function(_) | Value::Null) { rt.set_prototype(${value}, ${data})?; }`);continue;}
 if((prop.type==='ObjectMethod')||anonymous(prop.value)){const prefix=prop.type==='ObjectMethod'&&['get','set'].includes(prop.kind)?prop.kind:'';ctx.emit(`rt.set_function_name(${data}, ${nameKey}, ${quote(ctx,prefix)})?;`);}
 if(prop.type==='ObjectMethod'&&['get','set'].includes(prop.kind)){ctx.emit(`rt.literal_accessor(${value}, ${key}, ${prop.kind==='get'?`Some(${data})`:'None'}, ${prop.kind==='set'?`Some(${data})`:'None'}, true, true)?;`);}else ctx.emit(`rt.define_data(${value}, ${key}, ${data}, true, true, true)?;`);
 }return value;}
function staticUtf16Bytes(text){let out='b"';for(let i=0;i<text.length;i++){const unit=text.charCodeAt(i);for(const byte of [unit&255,unit>>>8]){if(byte===0)out+='\\0';else if(byte===34)out+='\\"';else if(byte===92)out+='\\\\';else if(byte>=32&&byte<127)out+=String.fromCharCode(byte);else out+='\\x'+byte.toString(16).padStart(2,'0');}}return out+'"';}
function array(node,ctx){if(node.elements.length>=256&&node.elements.every(element=>element?.type==='StringLiteral'))return ctx.temp(`rt.array_from_static_utf16(&[${node.elements.map(element=>staticUtf16Bytes(element.value)).join(',')}])?`);const value=ctx.temp('rt.array(&[])');if(node.elements.some(element=>element?.type==='SpreadElement')){const index=ctx.fresh('array_index');ctx.emit(`let mut ${index}: usize = 0;`);for(const element of node.elements){if(element?.type==='SpreadElement'){const input=emitExpression(element.argument,ctx),items=ctx.temp(`rt.argument_spread(${input})?`),item=ctx.fresh('spread_item');ctx.emit(`for ${item} in ${items} {`);const key=ctx.temp(`rt.string(&${index}.to_string())`);ctx.emit(`rt.define_data(${value}, ${key}, ${item}, true, true, true)?;`);ctx.emit(`${index} += 1;`);ctx.emit('}');}else{if(element){const item=emitExpression(element,ctx),key=ctx.temp(`rt.string(&${index}.to_string())`);ctx.emit(`rt.define_data(${value}, ${key}, ${item}, true, true, true)?;`);}ctx.emit(`${index} += 1;`);}}const lengthKey=stringValue(ctx,'length');ctx.emit(`rt.set(${value}, ${lengthKey}, Value::Number(${index} as f64), true)?;`);return value;}let index=0;for(const element of node.elements){if(element){const entry=emitExpression(element,ctx),key=stringValue(ctx,index);ctx.emit(`rt.define_data(${value}, ${key}, ${entry}, true, true, true)?;`);}index++;}if(node.elements.length&&node.elements.at(-1)===null){const key=stringValue(ctx,'length'),length=numberValue(ctx,index);ctx.emit(`rt.set(${value}, ${key}, ${length}, true)?;`);}return value;}

function template(node,ctx){let value=stringValue(ctx,node.quasis[0].value.cooked);for(let i=0;i<node.expressions.length;i++){const expression=emitExpression(node.expressions[i],ctx),text=ctx.temp(`rt.to_string(${expression})?`),asValue=ctx.temp(`Value::String(${text})`);value=ctx.temp(`rt.binary(BinaryOp::Add, ${value}, ${asValue})?`);const tail=stringValue(ctx,node.quasis[i+1].value.cooked);value=ctx.temp(`rt.binary(BinaryOp::Add, ${value}, ${tail})?`);}return value;}
export function emitExpression(node,ctx){if(!node)unsupportedExpression(node,'missing AST node');node=unwrap(node);const folded=foldNumeric(node,ctx);if(folded!==null)return folded;switch(node.type){
 case 'Identifier':{const scalar=ctx.scalarArrayTruthy?.(node);return scalar?ctx.temp(`if ${scalar.enabled} { Value::Bool(true) } else { ${scalar.fallback} }`):readReference(emitReference(node,ctx),ctx);}
 case 'ThisExpression':return ctx.thisValue;
 case 'NumericLiteral':return numberValue(ctx,node.value);
 case 'StringLiteral':return stringValue(ctx,node.value);
 case 'RegExpLiteral':{const units=Array.from({length:node.pattern.length},(_,i)=>node.pattern.charCodeAt(i)+'u16');return ctx.temp(`rt.regexp_utf16(&[${units.join(',')}], ${quote(ctx,node.flags)})?`);}
 case 'BooleanLiteral':return ctx.temp(`Value::Bool(${node.value?'true':'false'})`);
 case 'NullLiteral':return ctx.temp('Value::Null');
 case 'FunctionExpression':case 'ArrowFunctionExpression':return closure(node,ctx);
 case 'MemberExpression':{const scalar=ctx.scalarArrayMember?.(node);if(!scalar)return readReference(emitReference(node,ctx),ctx);const value=ctx.fresh('scalar_array_read');ctx.emit(`let ${value} = if ${scalar.enabled} { ${scalar.value} } else {`);const original=emitExpression(node,ctx.child({scalarArrayMember:()=>null,scalarArrayTruthy:()=>null}));ctx.emit(`${original}\n};`);return value;}
 case 'OptionalMemberExpression':case 'OptionalCallExpression':return optionalResult(node,ctx).value;
 case 'MetaProperty':if(node.meta.name==='new'&&node.property.name==='target')return ctx.temp('rt.new_target()');unsupportedExpression(node,'unsupported meta property');
 case 'AssignmentExpression':{const motion=ctx.unitMotionAxis?.(node);if(!motion)return assignment(node,ctx);const value=ctx.fresh('motion_axis');ctx.emit(`let ${value} = if let Some(value) = rt.try_unit_motion_axis(${ctx.thisValue}, ${motion.m}, ${motion.r}, ${motion.index}) { value } else {`);const original=assignment(node,ctx.child({unitMotionAxis:null}));ctx.emit(`${original}\n};`);return value;}
 case 'UpdateExpression':return update(node,ctx);
 case 'BinaryExpression':{const name=binaryOps[node.operator];if(!name)unsupportedExpression(node,'unknown binary operator '+node.operator);const left=emitExpression(node.left,ctx),right=emitExpression(node.right,ctx);return binaryValue(name,left,right,ctx);}
 case 'LogicalExpression':return logical(node,ctx);
 case 'ConditionalExpression':{const test=emitExpression(node.test,ctx),result=ctx.fresh('conditional');ctx.emit(`let mut ${result} = Value::Undefined;`);ctx.emit(`if rt.truthy(${test}) {`);const yes=emitExpression(node.consequent,ctx);ctx.emit(`${result} = ${yes};`);ctx.emit('} else {');const no=emitExpression(node.alternate,ctx);ctx.emit(`${result} = ${no};`);ctx.emit('}');return result;}
 case 'SequenceExpression':{let value;for(const item of node.expressions)value=emitExpression(item,ctx);if(!value)unsupportedExpression(node,'empty sequence');return value;}
 case 'UnaryExpression':{if(node.operator==='typeof'&&unwrap(node.argument).type==='Identifier'){const id=unwrap(node.argument),local=typeof ctx.nativeLocal==='function'?ctx.nativeLocal(id.name,id):null;if(local){const value=ctx.temp(local);return ctx.temp(`rt.unary(UnaryOp::TypeOf, ${value})?`);}const known=typeof ctx.knownBinding==='function'?ctx.knownBinding(id.name,id):null;if(known){const value=ctx.temp(`rt.read_binding(${known})?`);return ctx.temp(`rt.unary(UnaryOp::TypeOf, ${value})?`);}return ctx.temp(`${typeof ctx.envCall==='function'?ctx.envCall("typeof_name",ctx.env,id.name):`rt.typeof_name(${ctx.env}, ${quote(ctx,id.name)})`}?`);}if(node.operator==='delete'){if(unwrap(node.argument).type==='OptionalMemberExpression')return optionalResult(node.argument,ctx,{deleteLast:true}).value;if(isReference(node.argument)){const ref=emitReference(node.argument,ctx),result=ref.local?ctx.temp('false'):ref.kind==='binding'?ctx.temp(`rt.delete_binding(${ref.binding}, ${ctx.strict?'true':'false'})?`):ctx.temp(`rt.delete(${ref.base}, ${referenceKey(ref,ctx)}, ${ctx.strict?'true':'false'})?`);return ctx.temp(`Value::Bool(${result})`);}emitExpression(node.argument,ctx);return ctx.temp('Value::Bool(true)');}const name=unaryOps[node.operator];if(!name)unsupportedExpression(node,'unknown unary operator');const value=emitExpression(node.argument,ctx);return ctx.temp(`rt.unary(UnaryOp::${name}, ${value})?`);}
 case 'CallExpression':return call(node,ctx);
 case 'NewExpression':return call(node,ctx,true);
 case 'ObjectExpression':return object(node,ctx);
 case 'ArrayExpression':return array(node,ctx);
 case 'TemplateLiteral':return template(node,ctx);
 default:unsupportedExpression(node,'expression lowering is not implemented');
}}
