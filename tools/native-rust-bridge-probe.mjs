import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-rust-bridge');
const oracleProfile=JSON.parse(await readFile(resolve(root,'config/source-oracle-runtime.json'),'utf8'));
assert.equal(process.version,oracleProfile.node);assert.equal(process.versions.v8,oracleProfile.v8);
assert.equal(process.platform,oracleProfile.platform);assert.equal(process.arch,oracleProfile.architecture);
if(!oracleProfile.rawBitReferenceFlags.every(flag=>process.execArgv.includes(flag))||(process.env.NODE_OPTIONS||'')!==oracleProfile.rawBitReferenceNodeOptions){
  const child=spawnSync(process.execPath,[...oracleProfile.rawBitReferenceFlags,process.argv[1]],{cwd:root,env:{...process.env,NODE_OPTIONS:oracleProfile.rawBitReferenceNodeOptions},stdio:'inherit'});
  if(child.error)throw child.error;process.exit(child.status??1);
}
await mkdir(directory,{recursive:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
const original=(await readFile(resolve(root,'src/srcmodule/game_ui_1.js'),'utf8')).slice(4490466,4490673);
assert.equal(sha(original),'335399b229bffc4d41cf895a5483a3bc8eafbcd245668c2fe1e823eda597313a');
const buffer=new ArrayBuffer(8),view=new DataView(buffer);
function bits(value){view.setFloat64(0,value,false);return view.getBigUint64(0,false).toString(16).padStart(16,'0');}
const edges=[NaN,Infinity,-Infinity,0,-0,1,-1,95,95.00001,95.0001,Number.MIN_VALUE,Number.MAX_VALUE,1e-10,-1e-10];
let random=0x581abcd;function next(){random^=random<<13;random^=random>>>17;random^=random<<5;return random>>>0;}
const operators=['>','>=','<','<=','=='];
const cases=Array.from({length:20000},(_,i)=>[bits(i<edges.length**2?edges[i%edges.length]:(next()-0x80000000)/10000),bits(i<edges.length**2?edges[Math.floor(i/edges.length)]:(next()-0x80000000)/10000),operators[i%5]]);
const input=resolve(directory,'cases.json');await writeFile(input,JSON.stringify(cases));
const script=`var cc={error:function(message){events.push(message)}};var events=[];var compare=(${original});var alias=compare;
function fromBits(text){var array=new ArrayBuffer(8),v=new DataView(array);v.setUint32(0,parseInt(text.slice(0,8),16),false);v.setUint32(4,parseInt(text.slice(8),16),false);return v.getFloat64(0,false);}
var bytes=hermescli.loadFile(${JSON.stringify(input)}),text='';for(var i=0;i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);
var cases=JSON.parse(text),results=[];for(var i=0;i<cases.length;i++)results.push(compare(fromBits(cases[i][0]),fromBits(cases[i][1]),cases[i][2]));
results.push(compare({valueOf:function(){events.push('left');return 2;}},{valueOf:function(){events.push('right');return 3;}},'<'));
results.push(compare(1,2,'unknown'));
print(JSON.stringify({results:results,events:events,identity:compare===alias,functionSource:compare.toString(),name:compare.name,length:compare.length}));`;
const source=resolve(directory,'probe.js');await writeFile(source,script);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8'));
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),build=resolve(root,'work/downloads/hermes-build');
const include=resolve(root,'work/downloads',config.source.directory,'include');
function run(command,args,env=process.env){const result=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result;}
const poolDirectory=resolve(directory,'pools');await mkdir(poolDirectory,{recursive:true});
const cfile=resolve(directory,'probe.c');run(compiler,['-O','-emit-c',source,'-o',cfile],{...process.env,SHERMES_BINARY_STRING_DIR:poolDirectory});
let c=await readFile(cfile,'utf8');
const ascii=await readFile(resolve(poolDirectory,'s_ascii_pool.bin')),entries=await readFile(resolve(poolDirectory,'s_strings.bin'));
function string(index){const offset=entries.readUInt32LE(index*12),length=entries.readUInt32LE(index*12+4);return offset&0x80000000?null:ascii.subarray(offset,offset+length).toString('utf8');}
const info=/static SHNativeFuncInfo s_function_info_table\[\] = \{([\s\S]*?)\n\};/.exec(c);assert.ok(info,'Missing exact compiler function metadata');
const functions=info[1].trim().split('\n');const candidates=[];
for(let index=0;index<functions.length;index++){const id=Number(/source_index_plus_one = (\d+)/.exec(functions[index])[1]);if(id&&string(id-1)===original)candidates.push(index);}
assert.equal(candidates.length,1,'Source-identified trampoline must resolve exactly one function');
const index=candidates[0],signature=new RegExp('static SHLegacyValue (_'+index+'_[A-Za-z0-9_]+)\\(SHRuntime \\*shr\\) \\{');
const match=signature.exec(c);assert.ok(match,'Source metadata index must identify a generated C function');
const symbol=match[1],saved='simx_original_'+index;
const operatorIds=operators.map(operator=>{for(let id=0;id<entries.length/12;id++)if(string(id)===operator)return id;throw new Error('Missing operator literal');});
const wrapper=`extern unsigned char battle_compare_float(double,double,unsigned);
static bool simx_operator_matches(SHRuntime *shr,SHLegacyValue *frame,SHUnit *unit,unsigned index) {
  /* Materialization may GC; reread the rooted argument AFTER obtaining it. */
  SHLegacyValue literal=_sh_ljs_get_string(shr,unit->symbols[index]);
  return _sh_ljs_strict_equal(_sh_ljs_param(frame,3),literal);
}
static SHLegacyValue ${saved}(SHRuntime *shr);\nstatic SHLegacyValue ${symbol}(SHRuntime *shr) {
  _SH_MODEL();
  SHLegacyValue *frame=shr->stackPointer;
  SHLegacyValue a=_sh_ljs_param(frame,1),b=_sh_ljs_param(frame,2);
  if(_sh_ljs_is_double(a)&&_sh_ljs_is_double(b)&&_sh_ljs_is_string(_sh_ljs_param(frame,3))) {
    struct { SHLocals head; } locals;
    frame=_sh_enter(shr,&locals.head,0);locals.head.count=0;
    SHUnit *unit=shr->units[unit_index];
    unsigned operator;
    ${operatorIds.map((id,i)=>`${i?'else ':''}if(simx_operator_matches(shr,frame,unit,${id}))operator=${i};`).join('\n    ')}
    else {_sh_leave(shr,&locals.head,frame);return ${saved}(shr);}
    bool result=battle_compare_float(_sh_ljs_get_double(a),_sh_ljs_get_double(b),operator)!=0;
    _sh_leave(shr,&locals.head,frame);return _sh_ljs_bool(result);
  }
  return ${saved}(shr);
}\nstatic SHLegacyValue ${saved}(SHRuntime *shr) {`;
c=c.slice(0,match.index)+wrapper+c.slice(match.index+match[0].length);
c=c.replace('int main(int argc, char **argv) {','int simx_original_main(int argc, char **argv) {');
c+='\n#include <stdio.h>\nextern size_t battle_compare_float_hits(void);\nint main(int argc,char **argv){int result=simx_original_main(argc,argv);fprintf(stderr,"bridge_hits:%zu\\n",battle_compare_float_hits());return result;}\n';
const patched=resolve(directory,'probe-bridge.c');await writeFile(patched,c);
const rustc=resolve(root,'work/toolchain/rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc'),library=resolve(directory,'libbridge.a');
run(rustc,['--edition=2024','-O','-C','panic=abort','--crate-type=staticlib',resolve(root,'tools/native-rust-bridge.rs'),'-o',library]);
const binary=resolve(directory,'probe'),args=[patched,library,'-O2','-g0','-DNDEBUG','-fno-strict-aliasing','-fno-strict-overflow','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+include];
for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);args.push('-L'+path,'-Wl,-rpath,'+path);}
args.push('-lshermes_console','-lhermesvm','-ldl','-lpthread','-lm','-o',binary);run('cc',args);
const actualResult=run(binary,['-Xhermes-internal-test-methods']);const actual=JSON.parse(actualResult.stdout);
let expected;runInNewContext(script,{hermescli:{loadFile:()=>Buffer.from(JSON.stringify(cases))},print:text=>{expected=JSON.parse(text);}});
assert.deepEqual(actual,expected);const hits=Number(/bridge_hits:(\d+)/.exec(actualResult.stderr)[1]);assert.equal(hits,cases.length);
const report={version:1,matched:true,cases:cases.length,rustCalls:hits,fallbackCases:2,oracleProfile,originalSourceSha256:sha(original),functionSourceRetained:actual.functionSource===original,functionIdentityRetained:actual.identity,events:actual.events,compilerSha256:sha(await readFile(compiler)),rustSourceSha256:sha(await readFile(resolve(root,'tools/native-rust-bridge.rs'))),scope:'Isolated source-identified generated-C trampoline proof; scalar Number comparisons use Rust while coercing/unknown operator calls execute original source. Math.floor is the unchanged intrinsic in this fixture; no whole-battle qualification or speed claim.'};
await writeFile(resolve(root,'benchmarks/validation/native-rust-bridge.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
