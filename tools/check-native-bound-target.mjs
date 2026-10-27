import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createContext,runInContext,constants} from 'node:vm';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const profile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json')));
assert.equal(process.version,profile.node);assert.equal(process.versions.v8,profile.v8);
const flags=[...profile.rawBitReferenceFlags,'--expose-gc'];
if(JSON.stringify(process.execArgv)!==JSON.stringify(flags)){const r=spawnSync(process.execPath,[...flags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});process.exit(r.status??1);}
const buildFile='benchmarks/validation/native-bound-target-build.json',buildBytes=await readFile(resolve(root,buildFile)),build=JSON.parse(buildBytes);assert.equal(build.passed,true);
for(const [file,expected]of [[build.source.file,build.source.sha256],[build.output.file,build.output.sha256],[build.producer.file,build.producer.sha256]])assert.equal(sha(await readFile(resolve(root,file))),expected,'Changed bound observer '+file);
const addon=createRequire(import.meta.url)(build.output.file),resolveTarget=addon.resolveTarget;
let calls=0,getters=0,traps=0,forcedCollections=0;
function Target(){calls++;}
const ordinary=Target,bound=Target.bind({ignored:1},3),nested=bound.bind({ignored:2},4),native=Math.max,boundNative=native.bind(null,1);
const proxy=new Proxy(Target,{get(){traps++;throw Error('proxy get')},getOwnPropertyDescriptor(){traps++;throw Error('proxy descriptor')},ownKeys(){traps++;throw Error('proxy keys')},getPrototypeOf(){traps++;throw Error('proxy prototype')}});
// Use the captured builtin: setup bind legitimately reads Proxy name/length.
// Construct a separate transparent proxy, then revoke before observation.
const revocable=Proxy.revocable(Target,{}),boundProxy=Function.prototype.bind.call(revocable.proxy,null);revocable.revoke();
const rows=[];
function check(label,input,kind,target,depth){const before=[calls,getters,traps],r=resolveTarget(input);assert.equal(r.kind,kind,label);assert.strictEqual(r.target,target,label+' target identity');if(depth!==undefined)assert.equal(r.depth,depth,label+' depth');assert.deepEqual([calls,getters,traps],before,label+' observer effects');rows.push({label,kind:r.kind,targetKind:r.targetKind,depth:r.depth,scriptId:r.scriptId,identityMatched:true});return r;}
check('ordinary script function',ordinary,'unbound',Target,0);
check('bound source function',bound,'bound',Target,1);
check('nested bound source function',nested,'bound',Target,2);
check('unbound native function',native,'unbound',native,0);
check('bound native function',boundNative,'bound',native,1);
check('Proxy function remains opaque',proxy,'proxy',proxy,0);
check('revoked Proxy remains opaque',revocable.proxy,'proxy',revocable.proxy,0);
check('bound revoked Proxy remains opaque',boundProxy,'bound-proxy-target',revocable.proxy,1);
for(const [label,value]of [['undefined',undefined],['number',7],['plain object',{}],['symbol',Symbol('x')]])check('nonfunction '+label,value,'non-function',value,0);
for(const fn of [ordinary,bound,nested])for(const key of ['name','length','toString','toJSON','custom'])Object.defineProperty(fn,key,{get(){getters++;throw Error('function getter '+key)},configurable:true});
check('getter-bearing target',ordinary,'unbound',Target,0);
check('getter-bearing bound chain',nested,'bound',Target,2);
const context=createContext(constants.DONT_CONTEXTIFY),cross=runInContext('var target=function CrossRealm(){};({target:target,bound:target.bind(null).bind({})})',context);
check('cross-realm nested bound function',cross.bound,'bound',cross.target,2);
const stressCases=20000;
for(let n=0;n<stressCases;n++){
 const target=function Stress(){calls++;},one=target.bind(null,n),two=one.bind({ignored:n},n+1);
 if(n%257===0){global.gc();forcedCollections++;}
 const r=resolveTarget(n%2?one:two);assert.equal(r.kind,'bound');assert.strictEqual(r.target,target);assert.equal(r.depth,n%2?1:2);assert.equal(r.targetKind,'script');
}
let deep=function Deep(){calls++;};for(let n=0;n<4100;n++)deep=deep.bind(null);
const capped=resolveTarget(deep);assert.equal(capped.kind,'depth-limit');assert.equal(capped.depth,4096);assert.equal(capped.targetKind,'unresolved');assert.equal(resolveTarget(capped.target).kind,'bound');
global.gc();forcedCollections++;assert.deepEqual([calls,getters,traps],[0,0,0]);
const dependencies=[];for(const file of ['tools/check-native-bound-target.mjs',buildFile,build.source.file,build.output.file,build.producer.file,'config/source-oracle-runtime.json'])dependencies.push({file,sha256:sha(await readFile(resolve(root,file)))});
const report={version:1,passed:true,scope:'Actual public-V8 Function::GetBoundFunction metadata observer, no callback execution or bind interception. Resolves bound target identity only; bound receiver/arguments and closure values remain inaccessible. Proxy targets stay explicitly opaque. Source-only profiling aid, not battle performance or fidelity qualification.',qualifiesFor10000Target:false,node:process.version,v8:process.versions.v8,execArgv:process.execArgv,buildProof:{file:buildFile,sha256:sha(buildBytes)},api:{export:'resolveTarget(function)',fields:['kind','targetKind','depth','scriptId','target'],kinds:['unbound','bound','proxy','bound-proxy-target','non-function','depth-limit','unsupported-bound-target'],targetKind:'script when public ScriptId()>0; no-script-id is metadata, not proof of a particular native implementation',maximumDepth:4096},directedCases:rows,stressCases,forcedCollections,callbackCalls:calls,getterCalls:getters,proxyTraps:traps,depthLimitTested:true,retainedNativePointers:false,dependenciesAtFinish:dependencies,producer:{file:'tools/check-native-bound-target.mjs',sha256:sha(await readFile(import.meta.filename))},limitations:['Only pinned Node/V8 build and ABI supported','Depth-limit/Proxy results are unresolved, never silently attributed to a source target','GetBoundFunction exposes target, not boundThis, boundArgs or native closure state','No game callback is invoked, replaced or intercepted by this observer']};
await mkdir(resolve(root,'benchmarks/results'),{recursive:true});report.resultFile='benchmarks/results/'+new Date().toISOString().replaceAll(':','-')+'-native-bound-target.json';const bytes=JSON.stringify(report,null,2)+'\n';await writeFile(resolve(root,report.resultFile),bytes);await writeFile(resolve(root,'benchmarks/validation/native-bound-target.json'),bytes);console.log(JSON.stringify({passed:true,stressCases,forcedCollections,callbackCalls:calls,getterCalls:getters,proxyTraps:traps,resultFile:report.resultFile,rows}));
