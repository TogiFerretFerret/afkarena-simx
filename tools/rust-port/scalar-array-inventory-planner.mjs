// Source-pinned scalar replacement of a nonescaping dense local array. The
// native binding planner already rejects capture, eval and lexical ambiguity.
export const scalarArraySourceHashes=Object.freeze(['a0997743bf70f854c4d9ff8d45107cc2fa3a10395a1b68dbab33818c53bd488e']);
const functions=new Set(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression','ObjectMethod','ClassMethod','ClassPrivateMethod']);
const children=n=>Object.entries(n).flatMap(([k,v])=>['loc','extra','comments','tokens'].includes(k)?[]:Array.isArray(v)?v.filter(x=>x&&typeof x.type==='string'):v&&typeof v.type==='string'?[v]:[]);
function truthinessOnly(node,parents){const p=parents.get(node);if(!p)return false;if(p.type==='UnaryExpression'&&p.operator==='!')return true;if(['IfStatement','WhileStatement','DoWhileStatement','ForStatement','ConditionalExpression'].includes(p.type)&&p.test===node)return true;if(p.type==='LogicalExpression'){if(p.left===node&&p.operator==='&&')return true;return truthinessOnly(p,parents);}return false;}
function nonReferenceIdentifier(n,p){return p&&((['MemberExpression','OptionalMemberExpression'].includes(p.type)&&p.property===n&&!p.computed)||(['ObjectProperty','ObjectMethod','ClassMethod','ClassPrivateMethod'].includes(p.type)&&p.key===n&&!p.computed)||(['LabeledStatement','BreakStatement','ContinueStatement'].includes(p.type)&&p.label===n));}
function readMember(n,parents){const p=parents.get(n);if(!p)return false;if((p.type==='AssignmentExpression'&&p.left===n)||p.type==='UpdateExpression'||(p.type==='UnaryExpression'&&p.operator==='delete')||(['ForInStatement','ForOfStatement'].includes(p.type)&&p.left===n)||(['CallExpression','OptionalCallExpression','NewExpression'].includes(p.type)&&p.callee===n)||(p.type==='TaggedTemplateExpression'&&p.tag===n))return false;let a=p;while(a&&['ObjectProperty','RestElement','ArrayPattern','ObjectPattern','AssignmentPattern'].includes(a.type)){if(a.type.endsWith('Pattern')||a.type==='RestElement')return false;a=parents.get(a);}return true;}
export function planScalarLocalArrays(node,{parents,nativePlan,sourceSha256,allowedSourceHashes=scalarArraySourceHashes}={}){
 const result={arrays:[],members:new WeakMap(),truthy:new WeakSet(),declarations:new WeakMap()};if(!allowedSourceHashes.includes(sourceSha256)||!nativePlan?.names?.length)return result;
 const nodes=[];function walk(n){nodes.push(n);if(n!==node&&functions.has(n.type))return;for(const c of children(n))walk(c);}walk(node);
 for(const d of nodes){if(d.type!=='VariableDeclarator'||d.id.type!=='Identifier'||d.init?.type!=='ArrayExpression'||!d.init.elements.length||d.init.elements.length>8||d.init.elements.some(e=>!e||e.type==='SpreadElement')||!nativePlan.eligible(d.id.name,d.id))continue;
  const declaration=parents.get(d),block=parents.get(declaration);if(declaration?.type!=='VariableDeclaration'||declaration.kind!=='var'||block?.type!=='BlockStatement')continue;
  const refs=[],memberRefs=[],truthyRefs=[];let safe=true;
  for(const n of nodes){if(n.type!=='Identifier'||n.name!==d.id.name||n===d.id||nonReferenceIdentifier(n,parents.get(n)))continue;refs.push(n);if(!nativePlan.eligible(n.name,n)||n.start<d.init.end){safe=false;break;}let ancestor=n;while(ancestor&&ancestor!==block&&!functions.has(ancestor.type))ancestor=parents.get(ancestor);if(ancestor!==block){safe=false;break;}
   const p=parents.get(n);if(p?.type==='MemberExpression'&&p.object===n&&readMember(p,parents)){let index;if(!p.computed&&p.property.type==='Identifier'&&p.property.name==='length')index='length';else if(p.computed&&p.property.type==='NumericLiteral'&&Number.isInteger(p.property.value)&&p.property.value>=0&&p.property.value<d.init.elements.length)index=p.property.value;else{safe=false;break;}memberRefs.push([p,index]);}
   else if(truthinessOnly(n,parents))truthyRefs.push(n);else{safe=false;break;}
  }
  if(!safe||!refs.length)continue;const array={name:d.id.name,declaration:d,elements:d.init.elements,reads:memberRefs.length,truthinessReads:truthyRefs.length};result.arrays.push(array);result.declarations.set(d,array);for(const[n,index]of memberRefs)result.members.set(n,{array,index});for(const n of truthyRefs)result.truthy.add(n);
 }
 return result;
}
