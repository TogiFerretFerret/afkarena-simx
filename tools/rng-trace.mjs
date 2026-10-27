import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import { staticName } from './source-index.mjs';

// Hooks return their input, preserving sequence-expression and assignment values.
// Valid only for the shape-checked functions and nonthrowing/nonmutating hooks.
export function instrumentRng(source, name) {
  const ast=parse(`(${source})`);
  const wrappedAssignments=new WeakSet();
  const hook=(kind,value)=>({type:'CallExpression',callee:{type:'Identifier',name:'__traceValue'},arguments:[{type:'StringLiteral',value:kind},value]});
  traverse(ast,{
    VariableDeclarator: { exit(path) {
      if(name!=='ed.rand')return;
      const kind=path.node.id.name==='e'?'next_state_computed':path.node.id.name==='t'?'random_computed':null;
      if(kind)path.node.init=hook(kind,path.node.init);
    }},
    AssignmentExpression: { exit(path) {
      if(wrappedAssignments.has(path.node))return;
      const target=staticName(path.node.left);
      let kind;
      if(target==='ed.init_battle_seed')kind='initial_seed_write';
      else if(target==='random_seed')kind='state_write';
      else if(name==='ed.srand'&&target==='e')kind=path.node.right.type==='NumericLiteral'?'fallback_seed':'seed_computed';
      if(kind){wrappedAssignments.add(path.node);path.replaceWith(hook(kind,path.node));path.skip();}
    }},
    CallExpression: { exit(path) {
      if(staticName(path.node.callee)!=='ed.btLog.append')return;
      const argument=path.node.arguments[0];
      if(argument.type!=='BinaryExpression'||argument.operator!=='+')throw new Error('Unexpected log payload');
      argument.right=hook(name==='ed.srand'?'seed_log_value':'random_log_value',argument.right);
    }},
    ReturnStatement: { exit(path) {
      if(!path.node.argument)throw new Error('Unexpected empty return');
      if(name==='ed.randDontChangeSeed')path.node.argument=hook('peek',path.node.argument);
      path.node.argument=hook('return',path.node.argument);
    }},
  });
  return generate(ast).code;
}

const storage=new DataView(new ArrayBuffer(8));
export function bits(value) { storage.setFloat64(0,value,false); return storage.getBigUint64(0,false).toString(16).padStart(16,'0'); }
export function fromBits(hex) { storage.setBigUint64(0,BigInt(`0x${hex}`),false); return storage.getFloat64(0,false); }
export function compareTrace(expected,actual,{nanPolicy='bits'}={}) {
  if(!['bits','semantic'].includes(nanPolicy))throw new Error('Unknown NaN policy');
  if(expected.length!==actual.length)return {match:false,index:Math.min(expected.length,actual.length),reason:'event_count',expectedLength:expected.length,actualLength:actual.length};
  let nanBitDifferences=0;
  for(let i=0;i<expected.length;i++){
    for(const key of ['kind','value','state','initial']){
      const a=actual[i][key],e=expected[i][key];
      if(a===e)continue;
      if(nanPolicy==='semantic'&&key!=='kind'&&a!==null&&e!==null&&Number.isNaN(fromBits(a))&&Number.isNaN(fromBits(e))){nanBitDifferences++;continue;}
      return {match:false,index:i,field:key,reason:'event_field',expected:e,actual:a};
    }
  }
  return {match:true,nanBitDifferences};
}

export function parseTraceLine(line) {
  return line.split(' ').map(word=>{
    const fields=word.split(':');
    if(fields.length!==4)throw new Error('Malformed trace event');
    const [kind,...values]=fields;
    const [value,state,initial]=values.map(v=>{
      if(v==='-')return null;
      if(!/^[0-9a-f]{16}$/.test(v))throw new Error('Malformed binary64 field');
      return v;
    });
    if(state===null)throw new Error('Missing RNG state');
    return {kind,value,state,initial};
  });
}
