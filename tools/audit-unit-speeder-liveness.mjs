import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=resolve(import.meta.dirname,'..'),sha=value=>createHash('sha256').update(value).digest('hex');
export function analyzeUnitSpeederLiveness(c,functionSymbol='_564_update_11_'){
const signature='static SHLegacyValue '+functionSymbol+'(SHRuntime *shr) {';
const start=c.indexOf(signature);assert.ok(start>=0);assert.equal(c.indexOf(signature,start+signature.length),-1);const end=c.indexOf('\n}\n',start)+2;assert.ok(end>start);const fn=c.slice(start,end);
const firstMSPD=fn.indexOf('/*MSPD*/');assert.ok(firstMSPD>0);const entryLabel=[...fn.slice(0,firstMSPD).matchAll(/^(L\d+):$/gm)].at(-1);assert.ok(entryLabel);const entry=entryLabel.index,store=[...fn.matchAll(/^.*_sh_ljs_put_by_id_loose_rjs.*\/\*dt_action\*\/.*$/gm)];assert.equal(store.length,1);const cut=store[0].index+store[0][0].length;assert.ok(entry>0&&cut>entry);const region=fn.slice(entry,cut);assert.ok(/^\n  locals\.t\d+ = _sh_ljs_get_by_id_rjs_inline[^\n]*\/\*action_name\*\//.test(fn.slice(cut)));
const frameSize=Number(/_sh_enter\(shr, &locals.head, (\d+)\)/.exec(fn)[1]);assert.ok(frameSize>=9);assert.equal(fn.includes('\nCONT:'),false);
const split=fn.slice(0,cut)+'\nCONT:\n'+fn.slice(cut),labels=[...split.matchAll(/^(L\d+|CONT):$/gm)],blocks=[];
const token=/\b(?:locals\.t\d+|np\d+|frame\[-?\d+\])/g;
function tokens(text){return[...text.matchAll(token)].map(match=>match[0]);}
function instructions(body){
 const result=[];
 for(const raw of body.split('\n')){
  const line=raw.replace(/\/\*.*?\*\//g,'').replace(/\/\/.*$/,'').trim();if(!line||line===';')continue;
  const assignment=/^((?:locals\.t\d+)|(?:np\d+)|(?:frame\[-?\d+\]))\s*=\s*(.*);$/.exec(line),defs=new Set(assignment?[assignment[1]]:[]),uses=new Set(tokens(assignment?assignment[2]:line));
  const call=/_sh_ljs_call\(shr, frame, (\d+)\)/.exec(line);
  if(line.includes('_sh_ljs_call('))assert.ok(call,'Unsupported call-frame syntax');
  if(call){for(const offset of[-8,-7,-6])uses.add('frame['+(frameSize+offset)+']');for(let i=0;i<Number(call[1]);i++)uses.add('frame['+(frameSize-9-i)+']');for(let offset=-5;offset<=-1;offset++)defs.add('frame['+(frameSize+offset)+']');}
  if(line.includes('_sh_leave(shr, &locals.head, frame)'))uses.add('frame[-1]');
  result.push({line,uses:[...uses].sort(),defs:[...defs].sort(),implicitCallFrameRead:call?{argCount:Number(call[1]),frameSize}:null});
 }
 return result;
}
for(let i=0;i<labels.length;i++){
 const label=labels[i][1],body=split.slice(labels[i].index+labels[i][0].length,labels[i+1]?.index??split.length),ins=instructions(body),succ=[...new Set([...body.matchAll(/\bgoto (L\d+);/g)].map(m=>m[1]))];
 if(!succ.length&&!/\breturn\s/.test(body)&&i+1<labels.length)succ.push(labels[i+1][1]);
 const uses=new Set(),defs=new Set();for(const instruction of ins){for(const name of instruction.uses)if(!defs.has(name))uses.add(name);for(const name of instruction.defs)defs.add(name);}
 blocks.push({label,instructions:ins,successors:succ,uses,defs,liveIn:new Set(),liveOut:new Set()});
}
const byName=new Map(blocks.map(block=>[block.label,block]));assert.ok(blocks.length>10);for(const block of blocks)for(const name of block.successors)assert.ok(byName.has(name));
let iterations=0,changed=true;while(changed){changed=false;iterations++;assert.ok(iterations<1000);for(const block of blocks.toReversed()){
 const out=new Set(block.successors.flatMap(name=>[...byName.get(name).liveIn])),input=new Set([...block.uses,...[...out].filter(name=>!block.defs.has(name))]);
 if([...out].sort().join()!==[...block.liveOut].sort().join()||[...input].sort().join()!==[...block.liveIn].sort().join()){changed=true;block.liveOut=out;block.liveIn=input;}
}}
const regionLabels=new Set(blocks.slice(blocks.findIndex(block=>block.label===entryLabel[1]),blocks.findIndex(block=>block.label==='CONT')).map(block=>block.label)),incoming=[],outgoing=[];
for(const block of blocks)for(const successor of block.successors){if(!regionLabels.has(block.label)&&regionLabels.has(successor))incoming.push({from:block.label,to:successor});if(regionLabels.has(block.label)&&!regionLabels.has(successor))outgoing.push({from:block.label,to:successor});}
assert.ok(incoming.every(edge=>edge.to===entryLabel[1]));assert.deepEqual(outgoing,[{from:[...regionLabels].at(-1),to:'CONT'}]);
const entryLive=[...byName.get(entryLabel[1]).liveIn].sort(),exitLive=[...byName.get('CONT').liveIn].sort();
const assigned=[...new Set([...region.matchAll(/^\s*((?:locals\.t\d+)|(?:np\d+)|(?:frame\[-?\d+\]))\s*=/gm)].map(m=>m[1]))].sort();
const restore=exitLive.filter(name=>assigned.includes(name));
const firstUseWitnesses={};
for(const register of exitLive){
 const queue=[{label:'CONT',path:['CONT']}],seen=new Set();
 while(queue.length){const next=queue.shift();if(seen.has(next.label))continue;seen.add(next.label);const block=byName.get(next.label);let killed=false;
  for(const instruction of block.instructions){if(instruction.uses.includes(register)){firstUseWitnesses[register]={path:next.path,label:next.label,line:instruction.line};killed=true;break;}if(instruction.defs.includes(register)){killed=true;break;}}
  if(firstUseWitnesses[register])break;if(!killed)for(const label of block.successors)queue.push({label,path:[...next.path,label]});
 }
 assert.ok(firstUseWitnesses[register],'Live variable lacks a first-read witness '+register);
}
assert.equal(region.includes('_sh_ljs_call('),false,'Original speed region unexpectedly contains an explicit call');
const sourceReads=[...region.matchAll(/^.*_sh_ljs_get_by_id_rjs_inline.*$/gm)].map(match=>({line:match[0].trim(),label:[...region.slice(0,match.index).matchAll(/^(L\d+):$/gm)].at(-1)[1],property:/\/\*([^*]+)\*\//.exec(match[0])[1]}));
const proof={version:1,passed:true,kind:'Independent source-pinned UnitSpeeder interior CFG and register liveness audit',integrated:false,qualifiesFor10000Target:false,generated:{sha256:sha(c),functionSymbol,functionStart:start,functionEnd:end,functionSha256:sha(fn),regionStart:start+entry,regionEnd:start+cut,regionSha256:sha(region),entryLabel:entryLabel[1],continuation:'New label immediately after original dt_action store and before action_name read',source:region},analysis:{basicBlocks:blocks.length,iterations,entryLive,continuationLive:exitLive,regionAssigned:assigned,assignedAndLiveAtContinuation:restore,firstUseWitnesses,sourceReadOrder:sourceReads,requiredRestoredValues:{np2:"SHLegacyValue Number positive zero",np3:"SHLegacyValue Number100",np9:"SHLegacyValue Number raw_dt*speeder computed by the admitted original-order Rust kernel"},incomingEdges:incoming,outgoingEdges:outgoing,immutableCContext:['shr','shUnit','frame','locals.head including count=11/root-chain metadata'],frameSize,implicitFrameConvention:'Call argument/header indices are computed from pinned SH frame offsets plus the actual _sh_enter stackSize. _sh_leave reads caller previous-frame pointer at frame[-1].'},scopeNotes:[
 'This is a normal-control-flow liveness proof for source-pinned generated C, not a native execution or integration proof. Any altered compiler/function bytes or ABI require a fresh audit.',
 'All explicit normal exits from the speed region go to the new continuation after dt_action; only L22 is externally entered. Existing prefix side effects and calls must execute once before the guard; failed admission must resume L22, never restart Unit.update.',
 'Getter/proxy/host access, primitive coercion and original loose stores may throw or invoke JS despite having no explicit _sh_ljs_call in this block. An effect-free adapter must reject those cases before writes and leave original blocks to execute unchanged.',
 'Original store order is speeder, then raw_dt*speeder, then dt_action. Number-only input admission and ordinary writable own output descriptors permit precomputing arithmetic, but output writes must retain original order. Never fall back after first mutation.',
 'The semantic C live-out set is not identical GC root retention: all eleven locals.t0..t10 remain registered SH roots until _sh_leave. Region overwrites t3,t4,t5,t6 even though their values are dead at continuation. Leaving old dead slots untouched can change retention; do not claim arbitrary VM equivalence from register liveness alone.',
 'For a host admission restricted to finite Number MSPD/ATKHAST/SetSpeeder, object current_skill or falsy primitive current_skill, and finite Number/bool/null/undefined truth flags, original postregion t3(frozen/motionless), t4(lock flag or falsy skill), t5(prelock numeric speed) are non-GC primitives. t6 is Number on every truthy-skill branch (L27 initializes it), but otherwise remains its incoming value. Clearing t3/t4/t5 to undefined and t6 only when skill exists, after effect-free host success and before the next getter, preserves the original strong-root set without needing a no-WeakRef assumption. On rejection clear nothing. This is conditional on the stated host guard and actual splice, not activation evidence.',
 'Positive zero and100 constants must be restored explicitly even when the speed computation returns zero; np3 is read later by recovery-ratio arithmetic and was missing from the earlier observational assessment.',
 'Preserve rooted globals/receiver/raw_dt, undefined return register np0, caller frame[-1], all SH frame/header and root-list metadata. Host guards must not introduce unrooted pointers across allocation/GC safepoints. Pinned unboxed/uncompressed number layout can avoid allocation; other layouts require a separately proven GC-aware boxing path.'
 ],blocks:blocks.map(block=>({...block,uses:[...block.uses].sort(),defs:[...block.defs].sort(),liveIn:[...block.liveIn].sort(),liveOut:[...block.liveOut].sort()}))};
return proof;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const file=process.argv[2]??'work/native-warm23-no-proxy.units/partition_0.no-proxy.c',output=process.argv[3]??'benchmarks/validation/unit-speeder-liveness.json',symbol=process.argv[4]??'_564_update_11_';
 const c=await readFile(resolve(root,file),'utf8'),proof=analyzeUnitSpeederLiveness(c,symbol);proof.generated.file=file;
 const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'))),checkout=resolve(root,'work/downloads',config.source.directory);
 proof.inputs={};for(const path of ['tools/audit-unit-speeder-liveness.mjs','config/native-compiler-static-hermes.json','benchmarks/validation/unit-speeder-splice-assessment.json','benchmarks/validation/unit-speeder.json','benchmarks/validation/gc-observability.json','src/srcmodule/game_battle.js',...['include/hermes/VM/static_h.h','include/hermes/VMLayouts/sh_stack_frame_layout.h','lib/VM/StaticH.cpp','lib/VM/Runtime.cpp'].map(path=>resolve(checkout,path))])proof.inputs[path]=sha(await readFile(resolve(root,path)));
 const source=await readFile(resolve(root,'src/srcmodule/game_battle.js'),'utf8'),assessment=JSON.parse(await readFile(resolve(root,'benchmarks/validation/unit-speeder-splice-assessment.json')));assert.equal(sha(source.slice(assessment.sourceBlock.start,assessment.sourceBlock.end)),assessment.sourceBlock.sha256);
 proof.originalSourceBlock=assessment.sourceBlock;proof.originalSourceBlock.text=source.slice(assessment.sourceBlock.start,assessment.sourceBlock.end);
 const frameLayout=await readFile(resolve(checkout,'include/hermes/VMLayouts/sh_stack_frame_layout.h'),'utf8');for(const [name,value]of Object.entries({PreviousFrame:-1,NewTarget:-6,CalleeClosureOrCB:-7,ThisArg:-8,FirstArg:-9}))assert.ok(frameLayout.includes('SHStackFrame_'+name+' = '+value+','));
 await writeFile(resolve(root,output),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({passed:true,functionSha256:proof.generated.functionSha256,regionSha256:proof.generated.regionSha256,entryLive:proof.analysis.entryLive,continuationLive:proof.analysis.continuationLive,restore:proof.analysis.assignedAndLiveAtContinuation}));
}
