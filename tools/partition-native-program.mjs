import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { createHash } from 'node:crypto';
const traverse=traverseModule.default??traverseModule;
const sha=text=>createHash('sha256').update(text).digest('hex');

// This partitioner is for generated ordinary scripts whose ScriptCompletionValue
// is discarded by the native driver. No function body is rewritten. All global
// declaration instantiation occurs in the prelude before any original effects;
// later files contain no global declarations that could re-create deleted names.
export function partitionNativeProgram(source,{bodyUnits=7}={}){
  if(!Number.isSafeInteger(bodyUnits)||bodyUnits<1||bodyUnits>7)throw new Error('Expected one to seven body units (eight total native units maximum)');
  const ast=parse(source,{sourceType:'script'}),names=new Set(),functions=[],declarations=[],edits=[];
  const directives=ast.program.directives.map(node=>source.slice(node.start,node.end)).join('\n');
  traverse(ast,{
    Function(path){
      if(path.isFunctionDeclaration()&&!path.getFunctionParent()){
        if(!path.parentPath.isProgram())throw new Error('Annex B block functions are unsupported');
        functions.push(source.slice(path.node.start,path.node.end));
        declarations.push({start:path.node.start,source:source.slice(path.node.start,path.node.end)});
        edits.push({start:path.node.start,end:path.node.end,text:';'});
      }
      path.skip();
    },
    Class(path){if(!path.getFunctionParent()&&(path.isClassDeclaration()||path.node.body.body.some(node=>node.type==='StaticBlock')))throw new Error('Global class declarations and outer static blocks require a shared lexical environment');},
    VariableDeclaration(path){
      if(path.getFunctionParent())return;
      const node=path.node;if(node.kind!=='var')throw new Error('Global lexical declarations require a shared lexical environment');
      for(const declaration of node.declarations){if(declaration.id.type!=='Identifier')throw new Error('Global destructuring declarations are unsupported');names.add(declaration.id.name);}
      declarations.push({start:node.start,source:'var '+node.declarations.map(d=>d.id.name).join(',')+';'});
      const parent=path.parentPath.node;
      const loopBinding=(parent.type==='ForInStatement'||parent.type==='ForOfStatement')&&parent.left===node;
      let text;
      if(loopBinding){if(node.declarations.length!==1||node.declarations[0].init)throw new Error('Unsupported loop binding');text=node.declarations[0].id.name;}
      else{
        const assignments=node.declarations.filter(d=>d.init).map(d=>d.id.name+'=('+source.slice(d.init.start,d.init.end)+')');
        const forInit=parent.type==='ForStatement'&&parent.init===node;
        text=forInit?assignments.join(','):(assignments.length?'void ('+assignments.join(',')+');':';');
      }
      edits.push({start:node.start,end:node.end,text});
    },
  });
  edits.sort((a,b)=>a.start-b.start);
  function edited(start,end){let out='',at=start;for(const edit of edits){if(edit.end<=start)continue;if(edit.start>=end)break;if(edit.start<at||edit.end>end)throw new Error('Overlapping declaration edits');out+=source.slice(at,edit.start)+edit.text;at=edit.end;}return out+source.slice(at,end);}
  // V8 creates global object properties in declaration source order. Keeping
  // this skeleton interleaved also preserves observable Object.keys ordering.
  const prelude=directives+'\n;\n'+declarations.sort((a,b)=>a.start-b.start).map(d=>d.source).join('\n')+'\n';
  const statements=ast.program.body.filter(node=>node.type!=='FunctionDeclaration').map(node=>({start:node.start,end:node.end,text:edited(node.start,node.end)}));
  const target=Math.ceil(statements.reduce((sum,node)=>sum+Buffer.byteLength(node.text),0)/bodyUnits),groups=[];let current=[],bytes=0;
  for(let i=0;i<statements.length;i++){
    const node=statements[i],length=Buffer.byteLength(node.text);
    if(current.length&&bytes+length>target&&groups.length<bodyUnits-1){groups.push(current);current=[];bytes=0;}
    current.push(node);bytes+=length;
  }
  if(current.length)groups.push(current);
  const units=[{kind:'declaration-prelude',source:prelude},...groups.map((group,index)=>({kind:'ordered-effects',firstOriginalOffset:group[0].start,lastOriginalOffset:group.at(-1).end,source:directives+'\n;\n'+group.map(node=>node.text).join('\n')+'\n'}))];
  return{units:units.map((unit,index)=>({...unit,index,bytes:Buffer.byteLength(unit.source),sha256:sha(unit.source)})),proof:{originalSha256:sha(source),globalVariableNames:[...names],functionDeclarations:functions.length,allFunctionBodiesRetainedVerbatim:true,bodyOrder:'original top-level statement order; comma expressions remain intact',scriptCompletionValue:'discarded by host driver',unsupported:['shared global lexical declarations','Annex B block function declarations','global destructuring declarations','outer class static blocks'],totalUnits:units.length}};
}
