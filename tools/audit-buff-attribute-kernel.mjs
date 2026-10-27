// Source-backed design/semantic fixtures only. This does not install a fast path.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const sourceFile='src/srcmodule/game_battle.js',source=await readFile(new URL(sourceFile,root),'utf8');
const methods={};
for(const [name,next] of [['applyPercentValue','applyFixedValue'],['applyFixedValue','applyEffects']]){
 const start=source.indexOf(name+':function')+name.length+1,end=source.indexOf(','+next+':function',start);
 assert.ok(start>name.length&&end>start);const text=source.slice(start,end);assert.ok(text.startsWith('function(){')&&text.endsWith('}'));
 methods[name]={start,end,sha256:sha(text),text};
}
function env(){
 const ed={AttrDebugMgr:null,attrib_names_x:{ATK:'ATK%',HPR:'HPR%',MPR:'MPR%'},attrib_names_a:{ATK:'ATKBase',HPR:'HPRBase',MPR:'MPRBase'}};
 const funcs=Object.fromEntries(Object.entries(methods).map(([n,m])=>[n,vm.runInNewContext('('+m.text+')',{ed})]));
 const b={info:{ID:1,ATK:2,'ATK%':.5,ATKBase:'ATK'},owner:{attribs:{ATK:10,HPR:0,MPR:0},buff_effects:{noAttrUp:false,noAttrDown:false}},caster_attribs:{ATK:8},attrib:['ATK']};
 return {ed,funcs,b};
}
const fixtures=[];
function test(name,body){body();fixtures.push(name)}
test('percent initializes positive zero before multiply/add; signed zero is not reassociated',()=>{let {b,funcs}=env();b.info['ATK%']=-1;b.caster_attribs.ATK=0;b.owner.attribs.ATK=-0;funcs.applyPercentValue.call(b);assert.ok(Object.is(b.owner.attribs.ATK,-0));});
test('percent owner basis uses current target values in sequential duplicate attributes',()=>{let {b,funcs}=env();b.info.AddSource='owner';b.attrib=['ATK','ATK'];funcs.applyPercentValue.call(b);assert.equal(b.owner.attribs.ATK,22.5);});
test('percent caster/target alias uses current state, not a precomputed vector',()=>{let {b,funcs}=env();b.caster_attribs=b.owner.attribs;b.attrib=['ATK','ATK'];funcs.applyPercentValue.call(b);assert.equal(b.owner.attribs.ATK,22.5);});
test('lock callback runs even for an empty attribute list',()=>{let {b,funcs}=env(),events=[];b.attrib=[];b.owner.buff_effects.noAttrUp=true;b.owner.isAttrLockExemptedFor=(kind,id)=>{events.push([kind,id]);return false};funcs.applyPercentValue.call(b);assert.deepEqual(events,[['noAttrUp',1]]);});
test('debug callback precedes lock tests and can change owner flags and list',()=>{let {b,ed,funcs}=env(),events=[];ed.AttrDebugMgr={getDynamic(){events.push('debug');b.owner.buff_effects.noAttrUp=true;b.attrib=[];return null}};b.owner.isAttrLockExemptedFor=()=>{events.push('lock');return false};funcs.applyPercentValue.call(b);assert.deepEqual(events,['debug','lock']);});
test('percent reads AddSource twice; first getter cannot be memoized',()=>{let {b,funcs}=env(),reads=0;Object.defineProperty(b.info,'AddSource',{get(){return ++reads===1?'owner':'caster'}});funcs.applyPercentValue.call(b);assert.equal(reads,2);assert.equal(b.owner.attribs.ATK,14);});
test('percent debug basis is read separately from arithmetic basis',()=>{let {b,ed,funcs}=env(),reads=0,record;Object.defineProperty(b.caster_attribs,'ATK',{get(){return ++reads}});ed.AttrDebugMgr={getDynamic:()=>({}),recordBuffValue(...args){record=args}};funcs.applyPercentValue.call(b);assert.equal(reads,2);assert.equal(b.owner.attribs.ATK,11);assert.equal(record[6].basis,1);});
test('fixed HPR rage callback changes f before buffIncHPR and attribute write',()=>{let {b,funcs}=env(),events=[];b.attrib=['HPR'];b.info.HPR=-4;b.owner.rageObject={processHPR(owner,value,buff){events.push([owner===b.owner,value,buff===b]);owner.attribs.HPR=10;return -2}};funcs.applyFixedValue.call(b);assert.deepEqual(events,[[true,-4,true]]);assert.equal(b.buffIncHPR,-2);assert.equal(b.owner.attribs.HPR,8);});
test('fixed HPR writes buffIncHPR even when ordinary upward changes are locked',()=>{let {b,funcs}=env();b.attrib=['HPR'];b.info.HPR=3;b.owner.buff_effects.noAttrUp=true;b.owner.isAttrLockExemptedFor=()=>false;funcs.applyFixedValue.call(b);assert.equal(b.buffIncHPR,3);assert.equal(b.owner.attribs.HPR,3);});
test('prototype setter is observable and rejects a direct raw-slot store',()=>{let {b,funcs}=env(),events=[];b.owner.attribs=Object.create({get ATK(){return 10},set ATK(value){events.push(value)}});funcs.applyFixedValue.call(b);assert.deepEqual(events,[12]);});
test('attribute length captured once but each item read live after preceding setter',()=>{let {b,funcs}=env(),value=10;b.attrib=['ATK','ATK'];b.info.HPR=3;Object.defineProperty(b.owner.attribs,'ATK',{get(){return value},set(v){value=v;b.attrib[1]='HPR';b.attrib.push('MPR')}});funcs.applyFixedValue.call(b);assert.equal(value,12);assert.equal(b.owner.attribs.HPR,3);assert.equal(b.owner.attribs.MPR,0);});
test('throwing lock callback leaves arithmetic untouched; no fallback replay after prefix',()=>{let {b,funcs}=env(),calls=0,sentinel={};b.owner.buff_effects.noAttrUp=true;b.owner.isAttrLockExemptedFor=()=>{calls++;throw sentinel};assert.throws(()=>funcs.applyPercentValue.call(b),e=>e===sentinel);assert.equal(calls,1);assert.equal(b.owner.attribs.ATK,10);});
const profileFile='benchmarks/validation/native-no-proxy-measured-perf-source.json',profileBytes=await readFile(new URL(profileFile,root)),profile=JSON.parse(profileBytes);
const names=['applyPercentValue','applyFixedValue','addBuff','resetBuffApply'];
const report={version:1,passed:true,integrated:false,qualifiesFor10000Target:false,source:{file:sourceFile,sha256:sha(source)},methods,fixtures:{count:fixtures.length,names:fixtures},profile:{file:profileFile,sha256:sha(profileBytes),samples:profile.samples,inclusive:profile.inclusive.filter(x=>names.includes(x.name)),leaf:profile.leaf.filter(x=>names.includes(x.name)),note:'Inclusive ancestry overlaps. addBuff/resetBuffApply cost does not establish an arithmetic-only speedup.'},
 proposedFirstKernel:{method:'applyPercentValue',placement:'Whole-function guarded entry before source prefix; fallback only before any observable effect. Do not skip or replay getDynamic/isAttrLockExemptedFor callbacks.',
 guards:[
 'Use native getter-free metadata inspection, rejecting Proxy/Host/lazy/exotic receivers. JS Object.getPrototypeOf or descriptor inspection alone cannot guard arbitrary Proxies safely.',
 'Require current canonical own DATA links info, owner, owner.attribs, owner.buff_effects, caster_attribs, attrib; normal dense ordinary array with own length and every indexed element; reject holes/accessors/inherited items and non-string attribute keys.',
 'Require current exact original function identity/source metadata. Require AttrDebugMgr absent/falsy DATA, noAttrUp and noAttrDown falsy DATA, and all branch-needed name maps/current input values guarded as ordinary own DATA. A truthy debug manager may return false but still has required effects.',
 'Require finite numeric basis/coefficient/target values; exact JS truthiness for zero and negative zero. Reject strings, undefined, null, booleans and object coercions rather than translating ||0 as generic numeric conversion.',
 'Require writable own target data slots; reject setters/prototype interception. Keep output objects/array identities and use GC-aware current slots, never raw descriptor pointers across allocation.',
 'First version should reject owner-basis selection and all input/output aliasing, or prove each repeated read/write using sequential current values. Duplicate attribute names cannot be reduced to one sum.',
 'Do not allocate or invoke JS during admit/execute. All guards and finite-result checks must complete before first write; if using a temporary execution plan, evaluate aliases and duplicate attributes against evolving target values.',
 'Maintain f=+0; f += (basis || +0) * coefficient; t[o] = t[o] + f in source order. No FMA, reassociation, vector reduction, reciprocal multiplication or reassigned operation order. Preserve raw signed-zero/NaN behavior or reject before mutation.',
 'Whole-function fast path only when every source prefix/loop read is proved nonobservable. Otherwise use a CFG-proven interior splice after callbacks with exact live locals and original continuation; never restart the whole function after callback effects.'
 ],
 fallbackScope:'Fixed-value HPR remains original because processHPR and buffIncHPR are observable. Fixed non-HPR may share an arithmetic kernel only after independent guard proof.',
 nextRequiredEvidence:['Measure actual admission/hit counts and time in this loop from the exact warmed fixture.','Actual untouched-native-vs-candidate tests with moving GC, current data mutation, aliasing, Proxy/accessor rejection, exceptions, callback mutations and f64::to_bits().','Strict full raw source battle gate and ordered event/state trace before broader fidelity qualification.'],performanceClaim:null}};
const output='benchmarks/validation/buff-attribute-kernel-assessment.json';await writeFile(new URL(output,root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,passed:true,fixtures:fixtures.length,integrated:false}));
