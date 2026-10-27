import assert from 'node:assert/strict';
import {patchFlatNumericCopyC} from './native-rust-bridge.mjs';

/** Opt-in source-identified trampoline. Neither guard invokes source JS on
 * rejection; the unchanged original function executes for every other value.
 * The original compiled function object and source metadata are retained.
 */
export async function patchCombinedCopyC(source,poolDirectory,original){
 const patched=await patchFlatNumericCopyC(source,poolDirectory,original);
 const needle='SHLegacyValue value=simx_flat_numeric_copy(shr,_sh_ljs_param(shr->stackPointer,1));';
 assert.equal(patched.source.split(needle).length,2,'Exactly one clone trampoline required');
 patched.source=patched.source.replace('static size_t simx_copy_hits=0;',
  'extern SHLegacyValue simx_empty_array_copy(SHRuntime *,SHLegacyValue);\nstatic size_t simx_empty_copy_hits=0,simx_numeric_copy_hits=0;\nstatic size_t simx_copy_hits=0;');
 patched.source=patched.source.replace(needle,`SHLegacyValue value=simx_empty_array_copy(shr,_sh_ljs_param(shr->stackPointer,1));
  if(!_sh_ljs_is_undefined(value))simx_empty_copy_hits++;
  else {
    value=simx_flat_numeric_copy(shr,_sh_ljs_param(shr->stackPointer,1));
    if(!_sh_ljs_is_undefined(value))simx_numeric_copy_hits++;
  }`);
 return{...patched,guards:['original intrinsic empty Array','flat finite numeric ordinary Object'],counters:['simx_copy_hits','simx_empty_copy_hits','simx_numeric_copy_hits']};
}
