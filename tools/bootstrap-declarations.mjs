import {runInContext} from 'node:vm';

/** Execute original declaration statements without an expression/IIFE wrapper.
 * A FunctionDeclaration's self-name resolves through its source global binding;
 * converting it into a named FunctionExpression would change reassignment.
 * These statements define functions only; this adapter never invokes their bodies.
 */
export function installBootstrapFunctionDeclarations(context,records){
  for(const record of records)runInContext(record.source,context,{filename:`${record.file}:${record.start}:original-function-declaration`});
}
