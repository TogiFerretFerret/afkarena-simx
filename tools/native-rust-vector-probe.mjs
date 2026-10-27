import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
import {patchScalarVectorsC,addBridgeCounterMain} from './native-rust-bridge.mjs';
import {firstDifference} from './native-report-compare.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-rust-vector');
const oracleProfile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,oracleProfile.node);assert.equal(process.versions.v8,oracleProfile.v8);
if(JSON.stringify(process.execArgv)!==JSON.stringify(oracleProfile.rawBitReferenceFlags)||(process.env.NODE_OPTIONS||'')!==oracleProfile.rawBitReferenceNodeOptions){const child=spawnSync(process.execPath,[...oracleProfile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:oracleProfile.rawBitReferenceNodeOptions},stdio:'inherit'});if(child.error)throw child.error;process.exit(child.status??1);}
await mkdir(directory,{recursive:true});const sha=value=>createHash('sha256').update(value).digest('hex');
const ir=JSON.parse(await readFile(resolve(root,'config/numeric-kernels.ir.json'),'utf8')),sourceText=await readFile(resolve(root,ir.source),'utf8');
const names=['ed.edpDistanceSQ','ed.edpLengthSQ','ed.edpDot','ed.edpCross'];
const kernels=names.map(name=>{const row=ir.kernels.find(kernel=>kernel.sourceName===name);const source=sourceText.slice(row.start,row.end);assert.equal(sha(source),row.sourceSha256);return{name,source,sha256:sha(source)};});
const buffer=new ArrayBuffer(8),view=new DataView(buffer);function bits(value){view.setFloat64(0,value,false);return view.getBigUint64(0,false).toString(16).padStart(16,'0');}
let state=0x51abc2;function next(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
const edges=[0,-0,1,-1,Number.MIN_VALUE,-Number.MIN_VALUE,1e150,-1e150,1e-150,-1e-150];
const cases=Array.from({length:20000},(_,i)=>[...Array.from({length:4},(_,j)=>bits(i<200?edges[(i+j)%edges.length]:(next()-0x80000000)/100)),i%4===0]);
const input=resolve(directory,'cases.json');await writeFile(input,JSON.stringify(cases));
const script=`var functions=[${kernels.map(kernel=>kernel.source).join(',')}];var names=${JSON.stringify(names)};var events=[];
function bits(value){var a=new ArrayBuffer(8),v=new DataView(a);v.setFloat64(0,value,false);function hex(x){var s=x.toString(16);while(s.length<8)s='0'+s;return s;}return hex(v.getUint32(0,false))+hex(v.getUint32(4,false));}
function number(text){var a=new ArrayBuffer(8),v=new DataView(a);v.setUint32(0,parseInt(text.slice(0,8),16),false);v.setUint32(4,parseInt(text.slice(8),16),false);return v.getFloat64(0,false);}
var bytes=hermescli.loadFile(${JSON.stringify(input)}),wire='';for(var i=0;i<bytes.length;i++)wire+=String.fromCharCode(bytes[i]);var cases=JSON.parse(wire),outputs=[];
for(var i=0;i<cases.length;i++){var c=cases[i],a=[number(c[0]),number(c[1])],b=c[4]?a:[number(c[2]),number(c[3])];for(var j=0;j<4;j++)outputs.push(bits(functions[j](a,b)));a[0]=-a[0];a[1]+=1;for(var j=0;j<4;j++)outputs.push(bits(functions[j](a,b)));}
var fallback=[];function check(label,make){for(var j=0;j<4;j++){events=[];var pair=make();fallback.push({label:label,name:names[j],value:bits(functions[j](pair[0],pair[1])),events:events.slice()});}}
check('left-getter',function(){var a=[1,2];Object.defineProperty(a,'0',{get:function(){events.push('a0');return 1;}});return[a,[3,4]];});
check('right-getter-mutates-left',function(){var a=[1,2],b=[3,4];Object.defineProperty(b,'0',{get:function(){events.push('b0');a[1]=10;return 3;}});return[a,b];});
check('hole-with-prototype-getter',function(){var a=[,2],p=Object.create(Array.prototype);Object.defineProperty(p,'0',{get:function(){events.push('prototype0');return 1;}});Object.setPrototypeOf(a,p);return[a,[3,4]];});
check('proxy',function(){return[new Proxy([1,2],{get:function(target,key){events.push('proxy:'+key);return target[key];}}),[3,4]];});
check('array-like',function(){return[{0:1,1:2},[3,4]];});
check('coercing-element',function(){return[[{valueOf:function(){events.push('coerce');return 1;}},2],[3,4]];});
check('nonfinite',function(){return[[Infinity,2],[3,4]];});
check('undefined-hole',function(){return[[,2],[3,4]];});
check('nan-element',function(){return[[NaN,2],[3,4]];});
print(JSON.stringify({outputs:outputs,fallback:fallback,functionSources:functions.map(function(fn){return fn.toString();})}));`;
const jsfile=resolve(directory,'probe.js');await writeFile(jsfile,script);
function run(command,args,env=process.env){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:32*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),pools=resolve(directory,'pools');await mkdir(pools,{recursive:true});
const cfile=resolve(directory,'original.c');run(compiler,['-O','-emit-c',jsfile,'-o',cfile],{...process.env,SHERMES_BINARY_STRING_DIR:pools});
const patch=await patchScalarVectorsC(await readFile(cfile,'utf8'),pools,kernels),patched=resolve(directory,'bridge.c');await writeFile(patched,addBridgeCounterMain(patch.source));
const library=resolve(directory,'libbridge.a'),rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc');run(rustc,['--edition=2024','-O','-C','panic=abort','--crate-type=staticlib',resolve(root,'tools/native-rust-bridge.rs'),'-o',library]);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8')),build=resolve(root,'work/downloads/hermes-build'),binary=resolve(directory,'probe');
const ccArgs=[patched,library,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+resolve(root,'work/downloads',config.source.directory,'include')];
for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);ccArgs.push('-L'+path,'-Wl,-rpath,'+path);}ccArgs.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',binary);run('cc',ccArgs);
const execution=run(binary,['-Xhermes-internal-test-methods']),actual=JSON.parse(execution.stdout);let expected;runInNewContext(script,{hermescli:{loadFile:()=>Buffer.from(JSON.stringify(cases))},print:text=>{expected=JSON.parse(text);}});
const finiteDifference=firstDifference(actual.outputs,expected.outputs),fallbackDifference=firstDifference(actual.fallback,expected.fallback),identityDifference=firstDifference(actual.functionSources,expected.functionSources);
const counts=/vector_hits:([\d,]+)/.exec(execution.stderr)[1].split(',').map(Number);assert.deepEqual(counts,[40000,40001,40000,40000]);
const report={version:1,matched:!finiteDifference&&!fallbackDifference&&!identityDifference,oracleProfile,sourceCases:cases.length,finiteRawBitOutputs:cases.length*8,rustHits:Object.fromEntries(names.map((name,index)=>[name,counts[index]])),mutableCanonicalVectors:true,aliasCases:cases.filter(row=>row[4]).length,fallbackCases:actual.fallback.length,finiteDifference,fallbackDifference,identityDifference,kernels:kernels.map(({source,...row})=>row),compilerSha256:sha(await readFile(compiler)),vmSha256:sha(await readFile(resolve(build,'lib/libhermesvm.so'))),scope:'Source scalar geometry through canonical guarded VM arrays and existing Rust kernels; unsupported shapes execute original source without extra getters/traps. Not whole-battle qualification.'};
await writeFile(resolve(root,'benchmarks/validation/native-rust-vector.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(!report.matched)process.exitCode=1;
