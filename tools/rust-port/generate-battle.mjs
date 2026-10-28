import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {compileSource} from './compile.mjs';
const root=resolve(import.meta.dirname,'../..'),sha=value=>createHash('sha256').update(value).digest('hex');
const check=process.argv.includes('--check'),directory='crates/generated-battle';
const selected=[
 {module:'unit_update',config:'config/unit-translation.json'},
 {module:'skill_update',config:'config/skill-translation.json',name:'ed.Skill.update'},
 {module:'engine_tick',config:'config/scheduler-translation.json'},
 {module:'buff_update',config:'config/buff-translation.json',name:'ed.Buff.update'},
 {module:'set_hp',config:'config/unit-resources-translation.json',name:'setHp'},
 {module:'set_mp',config:'config/unit-resources-translation.json',name:'setMp'},
 {module:'unit_add_buff',config:'config/generated-battle-source.json',name:'ed.Unit.addBuff'},
 {module:'reset_buff_apply',config:'config/generated-battle-source.json',name:'ed.Unit.resetBuffApply'},
];
const inputs=new Map();
async function input(file){const bytes=await readFile(resolve(root,file));const digest=sha(bytes);if(inputs.has(file)&&inputs.get(file)!==digest)throw Error('Source changed during generation: '+file);inputs.set(file,digest);return bytes;}
for(const file of ['tools/rust-port/generate-battle.mjs','tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/bindings.mjs','tools/rust-port/statements.mjs','tools/rust-port/CONTRACT.md'])await input(file);
const files=new Map(),modules=[];
for(const item of selected){
 const config=JSON.parse(await input(item.config));
 const pin=item.name?config.functions.find(fn=>fn.name===item.name):config;
 if(!pin)throw Error('Missing pinned function '+item.name);
 const sourceFile=config.source,full=(await input(sourceFile)).toString('utf8'),source=full.slice(pin.start,pin.end);
 if(config.sourceSha256&&sha(full)!==config.sourceSha256)throw Error('Changed pinned source file '+sourceFile);
 if(sha(source)!==pin.sha256)throw Error('Changed original function '+(pin.name??pin.sourceName));
 const name=pin.name??pin.sourceName,result=compileSource(source,{filename:sourceFile+'#'+name+'@'+pin.start,mode:'function',moduleName:item.module});
 const file=directory+'/src/'+item.module+'.rs';
 const header=`// Original source: ${sourceFile}, UTF-16 offsets ${pin.start}..${pin.end}.\n// Source method: ${name}. SHA-256 ${pin.sha256}.\n// Generated execution code; compile coverage does not establish battle fidelity.\n`;
 const rust=header+result.rust;files.set(file,rust);
 modules.push({module:item.module,file,name,config:item.config,source:{file:sourceFile,start:pin.start,end:pin.end,sha256:pin.sha256},generatedSha256:sha(rust),rustLines:rust.split('\n').length,coverage:result.manifest});
}
const lib='//! Generated Rust functions from the pinned original battle source.\n//! JavaScript is a build-time input and independent reference, never an execution backend.\n//! These modules are not a complete simulator; all called game dependencies still need native implementations.\n'+selected.map(item=>'pub mod '+item.module+';').join('\n')+'\n';
files.set(directory+'/src/lib.rs',lib);
for(const [file,expected]of inputs)if(sha(await readFile(resolve(root,file)))!==expected)throw Error('Input changed during generation: '+file);
const manifest={version:1,deterministic:true,executionBackend:'Generated Rust plus native Rust js-runtime; no JS engine/interpreter execution fallback.',modules,sourceInputs:Object.fromEntries(inputs),completeCompileCoverage:modules.every(item=>item.coverage.complete),compiledFunctions:modules.reduce((sum,item)=>sum+item.coverage.compiledFunctions,0),unsupportedFunctions:modules.reduce((sum,item)=>sum+item.coverage.unsupportedFunctions,0),semanticallyQualified:false,qualifiesFor10000Target:false,qualification:'This records deterministic generated source and AST compile coverage only. A supported AST body can still fail Rust compilation or runtime semantic tests. Unsupported function bodies are explicit hard-failure stubs in generated Rust and are listed per function; they are never successful no-ops. Native game dependencies, source differential gates and complete faithful battles remain separate requirements.'};
files.set(directory+'/manifest.json',JSON.stringify(manifest,null,2)+'\n');
if(!check)await mkdir(resolve(root,directory,'src'),{recursive:true});
for(const [file,text]of files){if(check){const actual=await readFile(resolve(root,file),'utf8');if(actual!==text)throw Error('Generated output is stale: '+file);}else await writeFile(resolve(root,file),text);}
console.log(JSON.stringify({checked:check,modules:modules.map(item=>({name:item.name,file:item.file,complete:item.coverage.complete,functions:item.coverage.functions.length,unsupported:item.coverage.unsupportedFunctions,rustLines:item.rustLines})),completeCompileCoverage:manifest.completeCompileCoverage,compiledFunctions:manifest.compiledFunctions,unsupportedFunctions:manifest.unsupportedFunctions}));
