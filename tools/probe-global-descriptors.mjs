import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createContext,runInContext,constants} from 'node:vm';
import {spawnSync} from 'node:child_process';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
if(!process.execArgv.includes('--jitless')||(process.env.NODE_OPTIONS??'')!==''){
 const child=spawnSync(process.execPath,['--jitless',import.meta.filename,...process.argv.slice(2)],{cwd:root,env:{...process.env,NODE_OPTIONS:''},stdio:'inherit'});
 if(child.error)throw child.error;process.exit(child.status??1);
}
const source=`var uninitialized;var initialized=2;function declared(){}
var __probeNames=['uninitialized','initialized','declared'],__probeOut=[];
for(var __probeI=0;__probeI<__probeNames.length;__probeI++){
 var __probeName=__probeNames[__probeI],__probeD=Object.getOwnPropertyDescriptor(globalThis,__probeName);
 __probeOut.push({name:__probeName,present:!!__probeD,writable:__probeD&&__probeD.writable,enumerable:__probeD&&__probeD.enumerable,configurable:__probeD&&__probeD.configurable,valueType:__probeD&&typeof __probeD.value});
}
Object.defineProperty(globalThis,'__probeSelf',{get:function(){return this},configurable:true});
print(JSON.stringify({descriptors:__probeOut,getterReceiverIsGlobal:__probeSelf===globalThis,objectConstructor:({}).constructor===Object,functionConstructor:declared.constructor===Function}));
`;
function oracle(ordinary){
 const context=ordinary?createContext(constants.DONT_CONTEXTIFY):createContext({});
 let output;context.print=text=>{output=JSON.parse(text)};
 runInContext(source,context);
 return{parentIsVmGlobal:context===runInContext('globalThis',context),observation:output};
}
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),directory=resolve(root,'work/global-descriptor-validation');
await mkdir(directory,{recursive:true});const input=resolve(directory,'probe.js'),binary=resolve(directory,'probe');await writeFile(input,source);
const flags=['-O','-Wc,-O1,-g0,-ffp-contract=off'];
const compiled=spawnSync(compiler,[...flags,input,'-o',binary],{cwd:root,encoding:'utf8'});
if(compiled.error)throw compiled.error;assert.equal(compiled.status,0,compiled.stderr);
const executed=spawnSync(binary,[],{cwd:root,encoding:'utf8'});
if(executed.error)throw executed.error;assert.equal(executed.status,0,executed.stderr);
const native=JSON.parse(executed.stdout),ordinary=oracle(true),contextified=oracle(false);
const digest=value=>createHash('sha256').update(value).digest('hex');
const report={version:1,reference:{node:process.version,v8:process.versions.v8,flags:process.execArgv,NODE_OPTIONS:process.env.NODE_OPTIONS??''},
 sourceSha256:digest(source),compiler:{file:relative(root,compiler),sha256:digest(await readFile(compiler)),flags},contextified,ordinary,native,
 ordinaryMatchesNative:JSON.stringify(ordinary.observation)===JSON.stringify(native),contextifiedMatchesNative:JSON.stringify(contextified.observation)===JSON.stringify(native),
 qualifiesForThroughputTarget:false,scope:'Actual compiler probe of source global bindings and realm identity; no battle workload'};
await writeFile(resolve(root,'benchmarks/validation/global-descriptors-native.json'),JSON.stringify(report,null,2)+'\n');
assert.equal(report.ordinaryMatchesNative,true,'Ordinary source VM differs from native global descriptors');
assert.equal(report.contextifiedMatchesNative,false,'Expected the diagnostic to expose contextified global flags');
console.log(JSON.stringify({ordinaryMatchesNative:report.ordinaryMatchesNative,contextifiedMatchesNative:report.contextifiedMatchesNative}));
