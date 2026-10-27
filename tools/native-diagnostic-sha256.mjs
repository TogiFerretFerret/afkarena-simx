import{readFile}from'node:fs/promises';import{resolve}from'node:path';import assert from'node:assert/strict';
export const diagnosticDigestSource='function diagnosticDigest(text){return portableTraceSha256(text);}';
// This selects a deliberately introduced diagnostic host hook, never a game
// function or portableTraceSha256 itself. Primitive strings have a pure SHA256
// contract, identical to Node crypto irrespective of mutable JS intrinsics.
export async function patchDiagnosticDigestC(source,poolDirectory){
 const ascii=await readFile(resolve(poolDirectory,'s_ascii_pool.bin')),entries=await readFile(resolve(poolDirectory,'s_strings.bin'));
 const string=id=>{const offset=entries.readUInt32LE(id*12),length=entries.readUInt32LE(id*12+4);return offset&0x80000000?null:ascii.subarray(offset,offset+length).toString('utf8');};
 const table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(source);assert.ok(table);
 const rows=table[1].trim().split('\n'),matches=[];
 for(let index=0;index<rows.length;index++){const id=Number(/source_index_plus_one = (\d+)/.exec(rows[index])[1]);if(id&&string(id-1)===diagnosticDigestSource)matches.push(index);}
 assert.equal(matches.length,1,'Diagnostic hook must resolve exactly once by retained source');
 const index=matches[0],pattern=new RegExp('static SHLegacyValue (_'+index+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\) \\{'),match=pattern.exec(source);assert.ok(match);
 const name=match[1],saved='simx_original_diagnostic_'+index;
 const wrapper=`extern SHLegacyValue simx_diagnostic_sha256(SHRuntime *,SHLegacyValue);
static size_t simx_diagnostic_sha_hits=0,simx_diagnostic_sha_fallbacks=0;
static SHLegacyValue ${saved}(SHRuntime *shr);
static SHLegacyValue ${name}(SHRuntime *shr){
 _SH_MODEL();_sh_check_native_stack_overflow(shr);
 if(!_sh_ljs_is_string(_sh_ljs_param(shr->stackPointer,1))){++simx_diagnostic_sha_fallbacks;return ${saved}(shr);}
 struct{SHLocals head;}locals;SHLegacyValue *frame=_sh_enter(shr,&locals.head,0);locals.head.count=0;
 SHLegacyValue result=simx_diagnostic_sha256(shr,_sh_ljs_param(frame,1));++simx_diagnostic_sha_hits;
 _sh_leave(shr,&locals.head,frame);return result;
}
static SHLegacyValue ${saved}(SHRuntime *shr){`;
 return{source:source.slice(0,match.index)+wrapper+source.slice(match.index+match[0].length),index,symbol:name};
}
