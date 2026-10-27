import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=text=>createHash('sha256').update(text).digest('hex');
/** Source-bound interior patch; only admitted numeric paths skip the region. */
export async function patchUnitSpeederC(source,poolDirectory,original,{liveness}={}){
 assert.ok(liveness?.passed,'Independent exact CFG live-out proof is mandatory');
 const ascii=await readFile(resolve(poolDirectory,'s_ascii_pool.bin')),entries=await readFile(resolve(poolDirectory,'s_strings.bin'));
 const string=index=>{const offset=entries.readUInt32LE(index*12),length=entries.readUInt32LE(index*12+4);return offset&0x80000000?null:ascii.subarray(offset,offset+length).toString('utf8');};
 const table=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(source);assert.ok(table);
 const candidates=[];table[1].trim().split('\n').forEach((row,index)=>{const id=Number(/source_index_plus_one = (\d+)/.exec(row)[1]);if(id&&string(id-1)===original)candidates.push(index);});
 assert.equal(candidates.length,1,'Unit.update retained source must resolve uniquely');
 const index=candidates[0],signature=new RegExp('static SHLegacyValue (_'+index+'_[A-Za-z0-9_]*)\\(SHRuntime \\*shr\\) \\{'),match=signature.exec(source);assert.ok(match);
 const end=source.indexOf('\n}\n',match.index+match[0].length)+2;assert.ok(end>match.index);
 const fn=source.slice(match.index,end);
 assert.equal(sha(fn),liveness.generated.functionSha256,'Changed generated Unit CFG');
 const label=liveness.generated.entryLabel;
 const start=fn.indexOf('\n'+label+':\n')+1,dt=/^.*_sh_ljs_put_by_id_loose_rjs.*\/\*dt_action\*\/.*$/m.exec(fn);assert.ok(start>0&&dt);
 const stop=dt.index+dt[0].length,block=fn.slice(start,stop);
 assert.equal(sha(block),liveness.generated.regionSha256,'Changed numerical block');
 assert.deepEqual([...liveness.analysis.continuationLive].sort(),['frame[-1]','locals.t0','locals.t1','locals.t2','np0','np2','np3','np9'].sort(),'Unexpected live-out ABI');
 assert.deepEqual(liveness.analysis.assignedAndLiveAtContinuation,['np2','np3','np9']);
 assert.match(block,/np9 = _sh_ljs_mul_rjs_inline\(shr, &locals\.t2, &np1\)/);
 const keys=['attribs','MSPD','config','is_boss','current_skill','info','SetSpeeder','basic_skill','ATKHAST','lockActionSpeeder','buff_effects','frozen','motionless','speeder','dt_action'];
 const ids=keys.map(key=>{for(let i=0;i<entries.length/12;i++)if(string(i)===key)return i;throw Error('Missing literal '+key);});
 const injected=`${label}:
  {
   SHSymbolID simx_keys[15]={${ids.map(i=>`get_symbols(shUnit)[${i}]`).join(',')}};
   SHLegacyValue simx_speed,simx_action;
   uint32_t simx_admitted=simx_unit_speeder(shr,locals.t1,locals.t2,simx_keys,&simx_speed,&simx_action,battle_unit_speeder);
   if(simx_admitted){
    locals.t3=_sh_ljs_undefined();locals.t4=_sh_ljs_undefined();locals.t5=_sh_ljs_undefined();
    if(simx_admitted&2U)locals.t6=_sh_ljs_undefined();
    np2=_sh_ljs_double(0);np3=_sh_ljs_double(100);np9=simx_action;
    simx_unit_speeder_hits++;
    goto SIMX_UNIT_SPEEDER_CONTINUATION;
   }
  }
`;
 const replacement=injected+block.slice((label+':\n').length)+'\nSIMX_UNIT_SPEEDER_CONTINUATION:\n ;';
 const declarations=`extern uint32_t simx_unit_speeder(SHRuntime*,SHLegacyValue,SHLegacyValue,const SHSymbolID*,SHLegacyValue*,SHLegacyValue*,unsigned char (*)(const double*,uint32_t,double*));
extern unsigned char battle_unit_speeder(const double*,uint32_t,double*);
static size_t simx_unit_speeder_hits=0;
size_t simx_unit_speeder_hit_count(void){return simx_unit_speeder_hits;}
`;
 return{source:source.slice(0,match.index)+declarations+fn.slice(0,start)+replacement+fn.slice(stop)+source.slice(end),symbol:match[1],index,keys,ids,originalFunctionSha256:sha(fn),blockSha256:sha(block)};
}
