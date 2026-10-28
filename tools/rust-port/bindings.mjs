// Cache only stable bindings owned by the current function. A reference under a
// lexical, catch, loop or block-function shadow keeps normal environment lookup.
// Globals and free names remain dynamic; their object/property shape can change.
const functionTypes=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
function patternNames(pattern,out=new Set()){
 if(!pattern)return out;
 if(pattern.type==='Identifier')out.add(pattern.name);
 else if(pattern.type==='RestElement')patternNames(pattern.argument,out);
 else if(pattern.type==='AssignmentPattern')patternNames(pattern.left,out);
 else if(pattern.type==='ArrayPattern')for(const item of pattern.elements)patternNames(item,out);
 else if(pattern.type==='ObjectPattern')for(const item of pattern.properties)patternNames(item.type==='RestElement'?item.argument:item.value,out);
 return out;
}
function declarationNames(statements,{functions=false}={}){
 const names=new Set();for(const statement of statements??[]){
  if(statement.type==='VariableDeclaration'&&statement.kind!=='var')for(const declaration of statement.declarations)patternNames(declaration.id,names);
  else if(statement.type==='ClassDeclaration'&&statement.id)names.add(statement.id.name);
  else if(functions&&statement.type==='FunctionDeclaration'&&statement.id)names.add(statement.id.name);
 }return names;
}
export function planLocalBindings(node,{parents,hoistedNames=[],parameterNames=[]}={}){
 if(!node||!functionTypes.has(node.type))return{names:[],eligible(){return false;}};
 if(!parents||typeof parents.get!=='function')throw Error('Local binding planning requires the complete AST parent map');
 const names=[...new Set([...parameterNames,...hoistedNames])],owned=new Set(names),shadows=new WeakMap();
 function scopeNames(scope){let result=shadows.get(scope);if(result)return result;
  if(scope.type==='BlockStatement')result=declarationNames(scope.body,{functions:scope!==node.body});
  else if(scope.type==='SwitchStatement')result=declarationNames(scope.cases.flatMap(part=>part.consequent),{functions:true});
  else if(scope.type==='CatchClause')result=patternNames(scope.param);
  else if(['ForStatement','ForInStatement','ForOfStatement'].includes(scope.type)){const declaration=scope.type==='ForStatement'?scope.init:scope.left;result=new Set();if(declaration?.type==='VariableDeclaration'&&declaration.kind!=='var')for(const entry of declaration.declarations)patternNames(entry.id,result);}
  else result=new Set();
  shadows.set(scope,result);return result;
 }
 return{names,eligible(name,identifier){
  if(!owned.has(name)||identifier?.type!=='Identifier'||identifier.name!==name)return false;
  let scope=parents.get(identifier);while(scope&&scope!==node){
   if(functionTypes.has(scope.type)||scope.type==='ClassDeclaration'||scope.type==='ClassExpression')return false;
   if(scopeNames(scope).has(name))return false;
   scope=parents.get(scope);
  }
  return scope===node;
 }};
}
