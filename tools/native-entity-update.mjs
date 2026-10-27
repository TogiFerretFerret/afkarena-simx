import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

export async function patchEntityUpdateC(source,poolDirectory,original){
 const ascii=await readFile(resolve(poolDirectory,'s_ascii_pool.bin'));
 const entries=await readFile(resolve(poolDirectory,'s_strings.bin'));
 const string=index=>{const offset=entries.readUInt32LE(index*12),length=entries.readUInt32LE(index*12+4);return offset&0x80000000?null:ascii.subarray(offset,offset+length).toString('utf8');};
 const table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(source);assert.ok(table);
 const candidates=[];
 table[1].trim().split('\n').forEach((row,index)=>{const id=Number(/source_index_plus_one = (\d+)/.exec(row)[1]);if(id&&string(id-1)===original)candidates.push(index);});
 assert.equal(candidates.length,1,'Entity update must resolve exactly one retained original source');
 const index=candidates[0],signature=new RegExp('static SHLegacyValue (_'+index+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\) \\{'),match=signature.exec(source);assert.ok(match);
 const symbol=match[1],saved='simx_entity_original_'+index;
 const ids=['position','velocity','direction'].map(key=>{for(let id=0;id<entries.length/12;id++)if(string(id)===key)return id;throw Error('Missing Entity property literal '+key);});
 const wrapper=`extern bool simx_entity_update(SHRuntime *,SHLegacyValue,SHLegacyValue,SHSymbolID,SHSymbolID,SHSymbolID,double (*)(double,double,double),unsigned char (*)(double,double),unsigned char (*)(void));
extern double battle_entity_component(double,double,double);
extern unsigned char battle_entity_should_flip(double,double);
extern unsigned char battle_entity_reference_fp_environment(void);
static size_t simx_entity_hits=0;
static SHLegacyValue ${saved}(SHRuntime *shr);
static SHLegacyValue ${symbol}(SHRuntime *shr) {
 _SH_MODEL();_sh_check_native_stack_overflow(shr);
 SHLegacyValue *frame=shr->stackPointer;SHUnit *unit=shr->units[unit_index];
 if(simx_entity_update(shr,_sh_ljs_param(frame,0),_sh_ljs_param(frame,1),${ids.map(id=>`unit->symbols[${id}]`).join(',')},battle_entity_component,battle_entity_should_flip,battle_entity_reference_fp_environment)){
  simx_entity_hits++;return _sh_ljs_undefined();
 }
 return ${saved}(shr);
}
static SHLegacyValue ${saved}(SHRuntime *shr) {`;
 return {source:source.slice(0,match.index)+wrapper+source.slice(match.index+match[0].length),index,symbol,ids};
}
