import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parseExpression} from '@babel/parser';

const root=resolve(import.meta.dirname,'..'),sha=text=>createHash('sha256').update(text).digest('hex');
const pin=JSON.parse(await readFile(resolve(root,'config/unit-translation.json'),'utf8'));
const source=await readFile(resolve(root,pin.source),'utf8'),body=source.slice(pin.start,pin.end);
assert.equal(sha(body),pin.sha256,'Unit source changed');
const rustFile='crates/battle-core/src/unit.rs',rust=await readFile(resolve(root,rustFile),'utf8');
const trait=/pub trait Hooks\{([\s\S]*?)\n\}/.exec(rust);assert.ok(trait);
const hooks=[...trait[1].matchAll(/fn (\w+)\(/g)].map(match=>match[1]);
const mappings={
 terminate:['this.terminate()','Actual source dispatch; early return branch.'],
 debug_checks:['console.log(this.name+" hp error")','Aggregate original localBot checks, including source property reads, isNaN/Math.abs and console dispatch.'],
 action_finished:['this.onActionFinished()','May change action/state/skills before action_elapsed write.'],
 add_buff:['this.addBuff(20,this)','Returned buff identity and subsequent timer write stay canonical.'],
 is_turn_based:['this.isMode_TB()','May mutate state; must execute before direction choice.'],
 fall:['this.fall()','May replace vectors after local velocity m was captured.'],
 stage_rect:['ed.battleEngine.getStageRect()','May replace position/velocity; local m retains earlier array identity.'],
 skill_is_basic:['this.skill_list[E]===this.skill_list[E].caster.basic_skill','Source identity/read expression, not a source function call. Retain live skill_list and caster/basic_skill reads.'],
 update_skill:['this.skill_list[E].update(n,P,e)','Live indexed receiver is reread after the basic-skill comparison.'],
 phase_finished:['this.current_skill.onPhaseFinished()','Resolve current_skill after preceding callbacks; retain source errors.'],
 cast_when_controlled:['this.ai.castSkillWhenControlled()','Source dispatch, no omitted AI mechanics.'],
 update_ai:['this.ai.update(e)','Source dispatch in ordinary and pet/freeze branches.'],
 is_pet:['this.isPet()','May mutate this.buff_effects; local R still references the pre-call effects object.'],
 recheck_manual:['this.recheckManualCast()','May kill unit or mutate live buffs.'],
 buff_has_effect:['O.hasEffectOrNot("stopBuff")','Also G.hasEffectOrNot("unheal"); preserve call order and post-call counter reread.'],
 update_buff:['O.update(e)','Original buff receiver is captured; live array length removal-by-one controls index decrement.'],
 transfer_mp_target:['this.getTransferMpTarget()','Target and all attributes must be read after callback.'],
 set_mp:['w.setMp(w.mp+x*e,this)','Read mp and compute argument before dispatch.'],
 buff_hpr_damage:['this.buff_list[E].updateHPRDamage(e)','Live array length/index each iteration.'],
 transfer_hp_target:['this.getTransferTarget()','Source permits falsey result; current Rust nonoptional UnitId requires proven non-null target or ABI extension.'],
 set_hp:['I.setHp(I.hp+F*e)','May mutate regen target and source unit.'],
 add_restore:['I.battledata.addRestore(F*e)','Read battledata after setHp, not before.'],
 fix_position:['ed.fixPosition(this.position)','Return identity replaces position, including aliases.'],
};
assert.deepEqual([...hooks].sort(),Object.keys(mappings).sort(),'Rust hook surface changed: update explicit source map');
const hookMap=hooks.map(name=>{
 const[needle,contract]=mappings[name],relative=body.indexOf(needle);assert.ok(relative>=0,`Source hook changed: ${name}`);
 return{name,sourceExpression:needle,start:pin.start+relative,end:pin.start+relative+needle.length,contract};
});
const begin=body.indexOf('var t=this.attribs.MSPD;'),end=body.indexOf('this.dt_action=n;',begin)+'this.dt_action=n;'.length;
assert.ok(begin>=0&&end>begin);const block=body.slice(begin,end),ast=parseExpression(body);
const calls=[];
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.start>=begin&&node.end<=end)calls.push(body.slice(node.start,node.end));for(const [key,value]of Object.entries(node))if(key!=='loc'&&key!=='extra')if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
walk(ast);assert.deepEqual(calls,[],'Selected block acquired a callback');
const isAliveCalls=(body.match(/\.isAlive\(\)/g)||[]).length;
assert.equal(isAliveCalls,8,'Implicit liveness dispatch changed');
const report={version:1,kind:'canonical-unit-controller-integration-contract',qualifiesFor10000Target:false,
 source:{...pin,sha256:sha(body)},rust:{file:rustFile,sha256:sha(rust),requiredHooks:hooks.length},hookMap,
 hiddenDispatch:{isAliveCalls,contract:'Original Unit.isAlive function identity/Number state-enum semantics must be proved for source unit, buff casters and regen targets; otherwise retain original method dispatch. Hooks do not presently model these calls.'},
 admission:['The current owned Rust World/Vec2Arena is a semantic reference, not a canonical VM-state adapter; copying it into/out of JS would create an unsafe second mutable world.',
 'Preserve original Unit.update code identity/closure/source metadata. Admit only source-proven method bodies and ordinary own data slots; getters, Proxies, inherited setters, overrides and coercing values execute original code.',
 'Read canonical rooted VM objects using GC-aware slot helpers. No raw slot or borrowed pointer survives a JS hook, allocation, GC or reentrancy boundary; re-resolve after each boundary.',
 'Preserve local references independently of current properties: m keeps original velocity even if fall/getStageRect replaces this.velocity; R keeps original effects across isPet.',
 'Every callback can mutate lists, attributes, effects, state and aliases. A one-time entry guard cannot prove later state. After any mutation, dispatch source or resume from the exact continuation; never restart original update after earlier mutations.',
 'Optional/null target semantics, source exceptions and the original nonzero/falsey predicates must remain exact. No hook may be replaced with a silent default.',
 'Check the pinned reference MXCSR and preserve ordered f64 arithmetic, explicit NaN propagation rules and VM array-store behavior.'],
 firstBlock:{name:'Unit action speeder and dt_action',start:pin.start+begin,end:pin.start+end,sha256:sha(block),source:block,sourceCalls:calls,
  outputWrites:['this.speeder = i','this.dt_action = e*i'],liveLocals:['r=e is used for movement; retain it in the original continuation','n=e*i is used for action timing and skill updates; native result must populate the same continuation value'],
  branches:['Boss MSPD lower bound -75','Current-skill SetSpeeder truthiness and positive override','Identity equality to basic_skill enables ATKHAST addition','lockActionSpeeder forces zero modifier','Positive versus negative haste formula','frozen or motionless forces exact positive zero speeder'],
  guard:['Guard at this block entry, after any debug/liveness callbacks, before either output write.',
   'Original receiver and config/attribs/effects/current_skill/info/basic_skill reads are side-effect-free ordinary data slots; output slots are own writable ordinary Number properties.',
   'Admit finite Number dt/MSPD/ATKHAST and SetSpeeder Number or null/undefined. Lock/boss/effect flags may be boolean or finite Number with exact JS truthiness; unsupported values fall back before any write.',
   'current_skill and basic_skill compare canonical object identity; no mirrored integer handles without a proven bijection.',
   'Compute all intermediates in exact source order and reject NaN output before mutation. Finite inputs can overflow MSPD+ATKHAST; dt=0 times infinite speeder can produce NaN, so input finiteness alone is insufficient.',
   'Store speeder first, then dt_action, through GC-aware VM helpers. No callback/allocation is required between these stores for the admitted own-data domain.'],
  integrationBoundary:'A whole-function trampoline cannot replace an interior block and then restart original Unit.update. Requires a source/IR continuation splice retaining r/n and original function metadata, or a canonical-state Rust controller that owns subsequent control flow and every required hook. No such splice is implemented by this audit.'},
 implementationStatus:'Source-pinned executable audit only; no unused callback adapter or mirrored world introduced.'};
await writeFile(resolve(root,'benchmarks/validation/native-unit-controller.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceMatched:true,requiredHooks:hooks.length,isAliveCalls,firstBlockBytes:block.length,firstBlockSourceCalls:calls.length,integrated:false}));
