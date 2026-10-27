import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';

// Assessment only: never edits generated C or installs a VM fast path.
const root=resolve(import.meta.dirname,'..');
const file=process.argv[2]??'work/native-warm23-entity.units/partition_0.original.c';
const output=process.argv[3]??'benchmarks/validation/unit-speeder-splice-assessment.json';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const c=await readFile(resolve(root,file),'utf8');
const audit=JSON.parse(await readFile(resolve(root,'benchmarks/validation/native-unit-controller.json')));
const kernelFile='benchmarks/validation/unit-speeder.json',kernelBytes=await readFile(resolve(root,kernelFile)),kernel=JSON.parse(kernelBytes);
const source=await readFile(resolve(root,audit.source.source),'utf8');
assert.equal(sha(source.slice(audit.firstBlock.start,audit.firstBlock.end)),audit.firstBlock.sha256);
assert.equal(kernel.source.sha256,audit.firstBlock.sha256);
const endMatches=[...c.matchAll(/^.*\/\*dt_action\*\/.*$/gm)].filter(match=>match[0].includes('_sh_ljs_put_by_id_loose_rjs'));
assert.equal(endMatches.length,1,'This exact C candidate must have one action-delta write');
const end=endMatches[0].index+endMatches[0][0].length;
const start=c.lastIndexOf('\nL22:\n',end)+1;
assert.ok(start>0);
const block=c.slice(start,end);
assert.ok(block.includes('/*MSPD*/')&&block.includes('/*SetSpeeder*/')&&block.includes('/*ATKHAST*/'));
assert.equal((block.match(/_sh_ljs_call\(/g)||[]).length,0);
const signature=[...c.slice(0,start).matchAll(/^static SHLegacyValue (\w+)\(SHRuntime \*shr\) \{/gm)].at(-1);
assert.ok(signature);
const report={version:1,kind:'assessment-only-unit-speeder-interior-splice',integrated:false,qualifiesFor10000Target:false,
 sourceBlock:{file:audit.source.source,start:audit.firstBlock.start,end:audit.firstBlock.end,sha256:audit.firstBlock.sha256},
 generatedCandidate:{file,sha256:sha(c),functionSymbol:signature[1],entryLabel:'L22',start,end,sha256OfBlock:sha(block),source:block,
  observedContinuationValues:{receiver:'locals.t1',rawDt:'locals.t2',actionDt:'np9',speeder:'np1',positiveZero:'np2'},
  assignedRegisters:[...new Set([...block.matchAll(/^\s*((?:locals\.t\d+)|(?:np\d+))\s*=/gm)].map(match=>match[1]))],
  continuation:'Immediately after the original dt_action store, before the action_name read. A new label and exact live-out restoration are required; there is currently no splice.'},
 arithmeticProof:{file:kernelFile,sha256:sha(kernelBytes),cases:kernel.cases,rawBitOutputs:kernel.rawBitOutputs,admitted:kernel.admitted,rejected:kernel.rejected},
 requirements:[
  'Bind the generated function to its exact retained original source through SHNativeFuncInfo and string pools; a matching property comment or label alone cannot authorize patching.',
  'Pin compiler, emitted source, generated C and exact block bytes. Labels and registers depend on compiler output; reject a changed CFG.',
  'Compute CFG use/def and all live-outs over every successor before replacing the region. Listed continuation values are observed uses, not a complete liveness proof. Preserve every incoming register not proved dead.',
  'Place getter-free guards at L22 after preceding debug/liveness calls; use canonical own ordinary data descriptors for receiver, attribs, config, effects, skill and info. Reject Proxies, getters, coercions and inherited output setters before either write.',
  'Read only branch-required values where missing properties are possible. In particular ATKHAST is needed only for the basic-skill branch, SetSpeeder only for current_skill, motionless only when frozen is false.',
  'Retain canonical current_skill/basic_skill object identity, exact truthiness and source arithmetic order. Check MXCSR and reject unsupported or computed-NaN results before mutation.',
  'Write speeder then dt_action with GC-aware VM helpers. Set action-delta and other proven live-out registers before jumping to the original continuation. Never restart Unit.update after preceding side effects.',
  'Differential-test the actual VM splice against the untouched function with setters/getters/proxies, aliasing, exceptions, callback mutations before entry, raw f64 bits and function-source metadata.',
  'Measure actual battle hit counts and inclusive/exclusive cost before claiming this arithmetic block is a significant hotspot.'
 ],
 measuredBattleHotspot:false,battleHitCount:null,performanceClaim:null,
 decision:'Defer native splice until profiling and CFG liveness proof. Existing Rust arithmetic is reusable, but the whole-function Entity trampoline cannot safely replace this interior block.'};
await writeFile(resolve(root,output),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,sourceBlockMatched:true,candidateFunction:signature[1],blockBytes:block.length,integrated:false,measuredBattleHotspot:false}));
