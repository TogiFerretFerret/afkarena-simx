import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';

const root=resolve(import.meta.dirname,'..');
const sha=x=>createHash('sha256').update(x).digest('hex');
const sourceFile='src/srcmodule/game_battle.js';
const source=await readFile(resolve(root,sourceFile),'utf8');
const expected='function(){var e=this.next_sound;e&&i>e.Delay&&this.playSound&&(ed.playBattleEffect(e.SoundName),this.next_sound_idx++,this.next_sound=this.current_phase.sound_list[this.next_sound_idx])}';
// This is a proof-only structured form. It is NOT installed into the live runtime:
// Function#toString and callback identity remain properties of the original VM.
export const structuredSoundCallback='function(){var e=this.next_sound;if(!e)return;if(!(i>e.Delay))return;if(!this.playSound)return;ed.playBattleEffect(e.SoundName);this.next_sound_idx++;this.next_sound=this.current_phase.sound_list[this.next_sound_idx]}';
const starts=[19940,37200],captureProofs=[];
const ast=parse(source,{sourceType:'script'});
traverse(ast,{FunctionExpression(path){
 if(!starts.includes(path.node.start))return;
 assert.equal(source.slice(path.node.start,path.node.end),expected);
 const outer=path.findParent(p=>p.isFunction());
 const binding=path.scope.getBinding('i');
 assert.ok(binding&&binding.constant&&binding.constantViolations.length===0);
 assert.equal(binding.kind,'var');
 assert.equal(source.slice(binding.path.node.start,binding.path.node.end),'i=this.current_phase_elapsed+e');
 assert.equal(binding.scope.path,outer);
 let dynamicScope=false;
 outer.traverse({WithStatement(){dynamicScope=true;},CallExpression(p){if(p.node.callee.type==='Identifier'&&p.node.callee.name==='eval')dynamicScope=true;}});
 assert.equal(dynamicScope,false,'Direct eval/with invalidates binding constancy proof');
 const enqueue=path.findParent(p=>p.isCallExpression()&&p.node.callee.type==='Identifier'&&p.node.callee.name==='clientCall');
 assert.ok(enqueue);
 assert.equal(source.slice(enqueue.node.start,enqueue.node.end),`clientCall(${expected}.bind(this))`);
 captureProofs.push({callback:{start:path.node.start,end:path.node.end,sha256:sha(expected)},enclosing:{start:outer.node.start,end:outer.node.end,sha256:sha(source.slice(outer.node.start,outer.node.end))},capture:{name:'i',kind:binding.kind,initializer:source.slice(binding.path.node.start,binding.path.node.end),initializerStart:binding.path.node.start,initializerEnd:binding.path.node.end,references:binding.referencePaths.map(p=>p.node.start),constantViolations:0,directEvalOrWith:false},creation:{start:enqueue.node.start,end:enqueue.node.end,expression:source.slice(enqueue.node.start,enqueue.node.end)}});
}});
assert.equal(captureProofs.length,2);
const originalFactory=Function('initialI','ed',`var i=initialI;return {callback:${expected},setI:function(v){i=v}}`);
const candidateFactory=Function('initialI','ed',`var i=initialI;return {callback:${structuredSoundCallback},setI:function(v){i=v}}`);
const numberBits=n=>{const b=Buffer.alloc(8);b.writeDoubleLE(n);return b.toString('hex');};
function atom(value){return typeof value==='number'?{f64:numberBits(value)}:typeof value==='bigint'?{bigint:String(value)}:value===undefined?{undefined:true}:value;}
function fixture(options){
 const events=[],sentinel={name:'sentinel'},sound={};
 let index=options.index??0,next=sound,phase={sound_list:['first','second','third']},played=0,cell;
 const fail=stage=>{if(options.throwAt===stage)throw sentinel;};
 const event=(kind,value)=>events.push(value===undefined?[kind]:[kind,atom(value)]);
 const receiver={};
 Object.defineProperties(sound,{
  Delay:{get(){event('get Delay');fail('Delay');if(options.coerceDelay)return{[Symbol.toPrimitive](hint){event('coerce Delay',hint);fail('Delay coercion');if(options.mutateCapture)cell.setI(-999);return options.delay??0;}};return options.delay??0;}},
  SoundName:{get(){event('get SoundName');fail('SoundName');if(options.replaceSoundOnName)next={replacement:true};return 'sound';}}
 });
 Object.defineProperties(receiver,{
  next_sound:{get(){event('get next_sound');fail('next_sound');return options.noSound?options.noSoundValue:next;},set(value){event('set next_sound',value===phase.sound_list[1]?'second':value===phase.sound_list[2]?'third':value===undefined?'undefined':'other');fail('set next_sound');next=value;}},
  playSound:{get(){event('get playSound');fail('playSound');return options.mute?0:true;}},
  next_sound_idx:{get(){event('get next_sound_idx',typeof index==='object'?'coercible':index);fail('next_sound_idx');return index;},set(value){event('set next_sound_idx',value);fail('set next_sound_idx');index=value;if(options.phaseOnIndexWrite)phase={sound_list:['new0','new1','new2']};}},
  current_phase:{get(){event('get current_phase');fail('current_phase');return new Proxy(phase,{get(target,key){event('phase get',String(key));fail('sound_list');return new Proxy(target[key],{get(list,key){event('list get',String(key));fail('list item');return list[key];}});}});}}
 });
 const ed=new Proxy({}, {get(target,key){event('ed get',String(key));fail('method');return function(name){assert.equal(this,ed);event('playBattleEffect',name);fail('call');played++;if(options.advanceDuringCall)index=1;if(options.replacePhaseDuringCall)phase={sound_list:['call0','call1','call2']};};}});
 if(options.coerceIndex)index={[Symbol.toPrimitive](hint){event('coerce index',hint);fail('index coercion');return options.bigint?0n:0;}};
 return {receiver,ed,initialI:options.i??2,events,sentinel,bind(value){cell=value;},snapshot(){return {index:atom(typeof index==='object'?'coercible':index),next:next===sound?'original':next===undefined?'undefined':next,played};}};
}
const cases=[{}, {noSound:true}, {noSound:true,noSoundValue:0}, {noSound:true,noSoundValue:NaN}, {i:0}, {i:NaN}, {i:-0}, {i:Infinity}, {i:'2'}, {delay:3}, {delay:2}, {mute:true}, {coerceDelay:true}, {coerceDelay:true,mutateCapture:true}, {coerceIndex:true}, {coerceIndex:true,bigint:true}, {index:0n}, {advanceDuringCall:true}, {phaseOnIndexWrite:true}, {replacePhaseDuringCall:true}, {replaceSoundOnName:true}, {index:NaN}, {index:Infinity}, {index:-0}, {index:'0'}];
for(const stage of ['next_sound','Delay','Delay coercion','playSound','method','SoundName','call','next_sound_idx','index coercion','set next_sound_idx','current_phase','sound_list','list item','set next_sound'])cases.push({throwAt:stage,coerceDelay:true,coerceIndex:true});
let checked=0;
for(const options of cases){
 const observations=[];
 for(const factory of [originalFactory,candidateFactory]){
  const f=fixture(options),cell=factory(f.initialI,f.ed);f.bind(cell);let thrown=null;
  try{cell.callback.call(f.receiver);}catch(error){if(error!==f.sentinel)throw error;thrown='sentinel';}
  observations.push({events:f.events,state:f.snapshot(),thrown});
 }
 assert.deepEqual(observations[1],observations[0],`First directed mismatch: ${JSON.stringify(options,(_key,value)=>typeof value==='bigint'?String(value)+'n':value)}`);checked++;
}
const report={version:1,passed:true,scope:'Source-pinned capture constancy and structured control-flow equivalence for two next_sound callback literals; not installed, not native execution and not battle qualification.',source:{file:sourceFile,sha256:sha(source),offsetUnit:'UTF-16 code units'},captureProofs,structuredForm:structuredSoundCallback,directedCases:checked,checks:['Current next_sound captured once before guard','Captured i read before Delay getter; relational coercion retained','playSound read only after both earlier guards','Current ed.playBattleEffect resolved before SoundName getter and called with ed receiver','Call completes before index read, numeric coercion and write','Current phase and sound_list read after increment; list resolved before CURRENT index read','Exceptions preserve exact completed prefix and sentinel identity','Negative zero, NaN, Infinity, strings, BigInt and object numeric coercion retained'],executionGraph:[{id:'read-sound',operation:'Get(this,next_sound)',next:'sound-truthy'},{id:'sound-truthy',operation:'ToBoolean(e)',true:'read-i-delay',false:'return-undefined'},{id:'read-i-delay',operation:'Read lexical i, Get(e,Delay), relational i>Delay including ToPrimitive order',true:'playSound',false:'return-undefined'},{id:'playSound',operation:'Get(this,playSound), ToBoolean',true:'sound-call',false:'return-undefined'},{id:'sound-call',operation:'Read current ed; Get(ed,playBattleEffect); Get(e,SoundName); Call with this=ed',next:'index-update'},{id:'index-update',operation:'Get(this,next_sound_idx); ToNumeric; add matching Number/BigInt one; Set(this,next_sound_idx)',next:'next-assignment'},{id:'next-assignment',operation:'Resolve this.next_sound reference; Get(this,current_phase); Get(phase,sound_list); Get(this,next_sound_idx); ToPropertyKey; Get(list,key); Set(this,next_sound)',next:'return-undefined'}],admissionContract:{captureI:'Binding constancy proven at both creation sites in the pinned source. Initializer + yields a primitive; a future f64-only ABI must still guard typeof i===number and preserve exact bits.',receiver:'Must retain exact bound receiver strongly, not reconstruct from target identity.',environment:'ed is read at dispatch; property getters, proxies and mutation remain observable. Never cache effect method, index, phase or sound_list across earlier observable operations.',creation:'Current source invokes callback.bind(this) through dynamic property lookup before clientCall. Rewriting creation must preserve builtin bind identity/fallback and logical callback identity/own descriptors/prototypes/source.',queue:'Retain original FIFO captured-array drain and every logical before/after event.'},blockers:['Existing public target resolver deliberately exposes only GetBoundFunction target, not bound receiver/arguments or lexical environment. It cannot populate a sound callback enum faithfully.','No source-creation-site environment/callback representation with original function identity and source/descriptor fallback is integrated. A target hash alone cannot replace this closure.','Even with primitive constant i, receiver and ed remain live object identities and original accessor/coercion/exception order must remain; the structured form is a proof artifact, not a fast path.'],qualifiesFor10000Target:false,performanceClaim:false,producer:{file:'tools/check-sound-callback-lowering.mjs',sha256:sha(await readFile(import.meta.filename))}};
await writeFile(resolve(root,'benchmarks/validation/sound-callback-lowering.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:true,directedCases:checked,captureSites:captureProofs.length,installed:false,performanceClaim:false}));
