import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

/** Identify compiled code through retained ORIGINAL source, not unstable C IDs.
 * The replacement leaves closure creation, identity and function metadata alone.
 * No heap state is mirrored. Non-Number arguments/unsupported operators and any
 * non-intrinsic Math.floor implementation run the complete original function.
 */
export async function patchCompareFloatC(source,poolDirectory,original,{guard=true}={}){
  const ascii=await readFile(resolve(poolDirectory,'s_ascii_pool.bin'));
  const entries=await readFile(resolve(poolDirectory,'s_strings.bin'));
  function string(index){const offset=entries.readUInt32LE(index*12),length=entries.readUInt32LE(index*12+4);return offset&0x80000000?null:ascii.subarray(offset,offset+length).toString('utf8');}
  const info=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(source);assert.ok(info,'Missing exact compiler function metadata');
  const functions=info[1].trim().split('\n'),candidates=[];
  for(let index=0;index<functions.length;index++){const id=Number(/source_index_plus_one = (\d+)/.exec(functions[index])[1]);if(id&&string(id-1)===original)candidates.push(index);}
  assert.equal(candidates.length,1,'Source-identified trampoline must resolve exactly one function');
  const index=candidates[0],signature=new RegExp('static SHLegacyValue (_'+index+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\) \\{');
  const match=signature.exec(source);assert.ok(match,'Source metadata index must identify a generated C function');
  const symbol=match[1],saved='simx_original_'+index;
  const operatorIds=['>','>=','<','<=','=='].map(operator=>{for(let id=0;id<entries.length/12;id++)if(string(id)===operator)return id;throw new Error('Missing operator literal');});
  const wrapper=`extern unsigned char battle_compare_float(double,double,unsigned);
${guard?'extern bool simx_intrinsic_math_floor_guard(SHRuntime *shr);':''}
static bool simx_operator_matches(SHRuntime *shr,SHLegacyValue *frame,SHUnit *unit,unsigned index) {
  /* Materialization may GC; reread the rooted argument AFTER obtaining it. */
  SHLegacyValue literal=_sh_ljs_get_string(shr,unit->symbols[index]);
  return _sh_ljs_strict_equal(_sh_ljs_param(frame,3),literal);
}
static SHLegacyValue ${saved}(SHRuntime *shr);
static SHLegacyValue ${symbol}(SHRuntime *shr) {
  _SH_MODEL();
  _sh_check_native_stack_overflow(shr);
  SHLegacyValue *frame=shr->stackPointer;
  SHLegacyValue a=_sh_ljs_param(frame,1),b=_sh_ljs_param(frame,2);
  if(_sh_ljs_is_double(a)&&_sh_ljs_is_double(b)&&_sh_ljs_is_string(_sh_ljs_param(frame,3))${guard?'&&simx_intrinsic_math_floor_guard(shr)':''}) {
    struct { SHLocals head; } locals;
    frame=_sh_enter(shr,&locals.head,0);locals.head.count=0;
    SHUnit *unit=shr->units[unit_index];
    unsigned operator;
    ${operatorIds.map((id,i)=>`${i?'else ':''}if(simx_operator_matches(shr,frame,unit,${id}))operator=${i};`).join('\n    ')}
    else {_sh_leave(shr,&locals.head,frame);return ${saved}(shr);}
    bool result=battle_compare_float(_sh_ljs_get_double(a),_sh_ljs_get_double(b),operator)!=0;
    _sh_leave(shr,&locals.head,frame);return _sh_ljs_bool(result);
  }
  return ${saved}(shr);
}
static SHLegacyValue ${saved}(SHRuntime *shr) {`;
  return {source:source.slice(0,match.index)+wrapper+source.slice(match.index+match[0].length),index,symbol,operatorIds,guard};
}

export function addBridgeCounterMain(source){
  assert.ok(source.includes('int main(int argc, char **argv) {')||source.includes('int main(int argc,char **argv) {'),'Missing known native main signature');
  source=source.replace(/int main\(int argc,\s*char \*\*argv\) \{/,'int simx_original_main(int argc,char **argv) {');
  return source+'\n#include <stdio.h>\nextern size_t battle_compare_float_hits(void);\nextern size_t battle_vector_hits(unsigned);\nint main(int argc,char **argv){int result=simx_original_main(argc,argv);fprintf(stderr,"bridge_hits:%zu\\nvector_hits:%zu,%zu,%zu,%zu\\n",battle_compare_float_hits(),battle_vector_hits(0),battle_vector_hits(1),battle_vector_hits(2),battle_vector_hits(3));return result;}\n';
}

export async function patchScalarVectorsC(source,poolDirectory,kernels){
  const ascii=await readFile(resolve(poolDirectory,'s_ascii_pool.bin')),entries=await readFile(resolve(poolDirectory,'s_strings.bin'));
  const string=index=>{const offset=entries.readUInt32LE(index*12),length=entries.readUInt32LE(index*12+4);return offset&0x80000000?null:ascii.subarray(offset,offset+length).toString('utf8');};
  const table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(source);assert.ok(table);
  const functions=table[1].trim().split('\n'),patched=[];
  const names={'ed.edpDistanceSQ':'distance_sq','ed.edpLengthSQ':'length_sq','ed.edpDot':'dot','ed.edpCross':'cross'};
  for(const kernel of kernels){
    assert.ok(names[kernel.name],'Unsupported scalar vector kernel');
    const candidates=[];for(let index=0;index<functions.length;index++){const id=Number(/source_index_plus_one = (\d+)/.exec(functions[index])[1]);if(id&&string(id-1)===kernel.source)candidates.push(index);}
    assert.equal(candidates.length,1,'Scalar vector original source must resolve exactly once');
    const index=candidates[0],signature=new RegExp('static SHLegacyValue (_'+index+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\) \\{'),match=signature.exec(source);assert.ok(match);
    const symbol=match[1],saved='simx_original_'+index,rust='battle_vec_'+names[kernel.name],binary=kernel.name!=='ed.edpLengthSQ';
    const wrapper=`extern bool simx_dense_finite_vec2(SHRuntime *,SHLegacyValue,double *);
extern unsigned char battle_reference_fp_environment(void);
extern double ${rust}(${binary?'double,double,double,double':'double,double'});
static SHLegacyValue ${saved}(SHRuntime *shr);
static SHLegacyValue ${symbol}(SHRuntime *shr) {
  _SH_MODEL();_sh_check_native_stack_overflow(shr);
  SHLegacyValue *frame=shr->stackPointer;double a[2],b[2];
  /* BOTH guards invoke no JS and allocate nothing before any specialization. */
  if(battle_reference_fp_environment()&&simx_dense_finite_vec2(shr,_sh_ljs_param(frame,1),a)${binary?'&&simx_dense_finite_vec2(shr,_sh_ljs_param(frame,2),b)':''}) {
    double result=${rust}(a[0],a[1]${binary?',b[0],b[1]':''});
    if(!isnan(result))return _sh_ljs_double(result);
  }
  return ${saved}(shr);
}
static SHLegacyValue ${saved}(SHRuntime *shr) {`;
    source=source.slice(0,match.index)+wrapper+source.slice(match.index+match[0].length);
    patched.push({name:kernel.name,index,symbol,rust});
  }
  return{source,patched};
}
