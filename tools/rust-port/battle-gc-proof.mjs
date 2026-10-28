import {createHash} from 'node:crypto';
import {parse} from '@babel/parser';

// Collection inside generated Rust is authorized only for this complete,
// reviewed source profile. In particular, the caller has no pending heap-valued
// expression temporaries outside the global bindings passed to __nativeRun.
export const battleGcSourceHashes=[
 'b5e25dfb1b26a3061ab101edad6cefa992829cbfbd6fe3f4a77392627d82e7d5',
 '0e47375dd4def87a0d467d07eb2bdc593e35df8500e76d008833c987cf2619fb',
 '0198c9c9d3cc4d7d5347563627b3b0f5ac49ed14d60184ca39eb0ffd7fe26f4b',
 '68d3e52d7c4e9f89c3006df71c6625ae848c4f5013018ce490c43b640963f163',
 'dc527307b9d28419a764548475b23dd2011415fc5a758d472e9882f3b233cfa9',
 'a45171e5947aba24a55aeb98a0bcd133e730c2bea42cbe535e89aa5ac37241d3',
 '516e5659d9c6bf486f11525b2847557b91a135486d675edfdb6e91593daab634'
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function isRootBattleCall(statement){
 const expression=statement?.expression;
 const assignment=expression?.type==='UnaryExpression'&&expression.operator==='void'?expression.argument:null;
 if(assignment?.type!=='AssignmentExpression'||assignment.operator!=='='||assignment.left?.type!=='Identifier'||assignment.left.name!=='__nativeResult')return false;
 const call=assignment.right;
 if(call?.type!=='CallExpression'||call.callee?.type!=='Identifier'||call.callee.name!=='__nativeRun'||call.arguments.length!==6)return false;
 return call.arguments.every((arg,index)=>index<2||index===4
  ?arg.type==='Identifier'&&arg.name===['__nativeRuntime','__nativeWire',null,null,'__nativeWallNow'][index]
  :index===5?arg.type==='StringLiteral'&&arg.value==='final'
  :arg.type==='NumericLiteral'&&arg.value===(index===2?20:3));
}
export function proveBattleGcProfile(coverage,bytes){
 if(coverage.units?.length!==7||bytes.length!==7)return{passed:false,reason:'Requires the complete seven-module profile'};
 for(let index=0;index<7;index++)if(coverage.units[index].index!==index||coverage.units[index].sha256!==battleGcSourceHashes[index]||sha(bytes[index])!==battleGcSourceHashes[index])return{passed:false,reason:'Unreviewed source profile',index};
 const caller=parse(bytes[6].toString('utf8'),{sourceType:'script'}).program;
 const calls=caller.body.filter(isRootBattleCall);
 if(calls.length!==1)return{passed:false,reason:'Requires the reviewed direct global-root call'};
 return{passed:true,profile:'frozen-no-proxy-20-after-3-v1',sourceHashes:[...battleGcSourceHashes],callerStart:calls[0].start,callerEnd:calls[0].end,
  scope:'Only the exact __nativeRun outer loop, env-backed bindings, verified global-root caller and runtime activation guards; no general collection during generated execution.'};
}
