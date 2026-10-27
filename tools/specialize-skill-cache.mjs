import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { runInContext } from 'node:vm';

const root=resolve(import.meta.dirname,'..');
const file='src/srcmodule/game_ui_1.js';
const originalParse='r=ed.parseUseSkillCacheStageBattle(o)';

/** Opt-in specialization of a NONESCAPING local parsed table. The source public
 * parser is retained. Changed data/parser/intrinsics take its original path.
 */
export async function installSkillCacheSpecialization(runtime){
  const source=await readFile(resolve(root,file),'utf8');
  const from=source.indexOf('ed.getNeedReadSkillCacheTb=function('),to=source.indexOf(',ed.parseUseSkillCacheStageBattle=',from);
  if(from<0||to<0)throw Error('Missing skill-cache source boundary');
  const body=source.slice(from+'ed.getNeedReadSkillCacheTb='.length,to);
  const contract=JSON.parse(await readFile(resolve(root,'config/skill-cache-specialization.json'),'utf8'));
  const digest=value=>createHash('sha256').update(value).digest('hex');
  if(digest(body)!==contract.source.sha256||digest(source.slice(contract.parser.start,contract.parser.end))!==contract.parser.sha256)throw Error('Stale skill-cache source proof');
  if(runtime.ed.parseUseSkillCacheStageBattle.toString()!==source.slice(contract.parser.start,contract.parser.end))throw Error('Skill-cache parser was replaced before specialization');
  if(body.split(originalParse).length!==2)throw Error('Skill-cache local parse shape changed');
  // Keep split and its allocation in source order. A fresh ordinary string-only
  // array has no observable identity: it is consumed by this pure parser only.
  const transformed=body.replace(originalParse,'r=__skillCacheLocalParse(o)');
  const setup=`(function(){
    var originalFunction=ed.getNeedReadSkillCacheTb,parser=ed.parseUseSkillCacheStageBattle;
    var raw=ed.getDataTable("Param").Stage.UseSkillCacheStageBattle.StrValue;
    var tokens=raw.split(";"),modes=[],i=0;
    // Admit only the validated plain string mode/integer-range grammar. Other
    // configurations retain the original implementation including warnings.
    while(i<tokens.length){var mode=tokens[i++];if(!/^[a-z_]+$/.test(mode))return null;modes.push(mode);
      var count=0;while(i<tokens.length&&/^[0-9]+$/.test(tokens[i])){if(i+1>=tokens.length||!/^[0-9]+$/.test(tokens[i+1]))return null;i+=2;count++;}if(!count)return null;}
    var objectProto=Object.prototype,push=Array.prototype.push,arrayCheck=Array.isArray;
    var parseIntOriginal=parseInt,isFiniteOriginal=isFinite,isNaNOriginal=isNaN;
    for(i=0;i<modes.length;i++)if(modes[i] in objectProto)return null;
    var parsed=parser(tokens),hits=0,misses=0;
    function __skillCacheLocalParse(value){
      var safe=ed.parseUseSkillCacheStageBattle===parser&&Array.prototype.push===push&&Array.isArray===arrayCheck&&parseInt===parseIntOriginal&&isFinite===isFiniteOriginal&&isNaN===isNaNOriginal&&value.length===tokens.length;
      for(var i=0;safe&&i<tokens.length;i++)if(value[i]!==tokens[i])safe=false;
      for(i=0;safe&&i<modes.length;i++)if(modes[i] in objectProto)safe=false;
      if(safe){hits++;return parsed;}misses++;return ed.parseUseSkillCacheStageBattle(value);
    }
    ed.getNeedReadSkillCacheTb=(${transformed});
    return{stats:function(){return{hits:hits,misses:misses};},restore:function(){ed.getNeedReadSkillCacheTb=originalFunction;}};
  })()`;
  const installed=runInContext(setup,runtime.context,{filename:'source-specialization-skill-cache.js'});
  if(!installed)throw Error('Source Param table is outside proven skill-cache grammar');
  return{...installed,provenance:{file,start:from+'ed.getNeedReadSkillCacheTb='.length,end:to,sha256:createHash('sha256').update(body).digest('hex'),scope:'Nonescaping parsed local table only; original parser and guarded fallback retained'}};
}
