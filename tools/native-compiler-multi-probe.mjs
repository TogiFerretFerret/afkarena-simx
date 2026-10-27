import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import { compileNativeUnits } from './native-compiler-multi.mjs';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-multi-probe');
const sha=value=>createHash('sha256').update(value).digest('hex');
await mkdir(directory,{recursive:true});
const chunks=[
 'function splitFactory(){var local=3;return {read:function(){return ed.value+local;},write:function(v){local=v;},source:function(){return splitFactory.toString();}};}\n',
 'function secondFactory(){return {first:splitFactory(),bytes:["汉字🙂",String.fromCharCode(0,0xD800,0xDC00,0xD800,65,0xDC00)]};}\n',
];
const main='var ed={value:17};var object=secondFactory();var out=[object.first.read()];object.first.write(8);ed.value=20;out.push(object.first.read(),object.first.source(),object.bytes,Object.getOwnPropertyDescriptor(globalThis,"splitFactory").enumerable);print(JSON.stringify(out));\n';
const factoryChunks=[];
for(let i=0;i<chunks.length;i++){const file=resolve(directory,'part'+i+'.js');await writeFile(file,chunks[i]);factoryChunks.push({file,sha256:sha(chunks[i])});}
const input=resolve(directory,'main.js'),output=resolve(directory,'probe');await writeFile(input,main);
async function run(command,args,stdout,stderr,env=process.env){const child=spawnSync(command,args,{cwd:root,env,encoding:'utf8',maxBuffer:16*1024*1024});await writeFile(stdout,child.stdout??'');await writeFile(stderr,child.stderr??'');if(child.error)throw child.error;return{code:child.status,signal:child.signal};}
const metadata={factoryChunks,outputSha256:sha(main)};
const built=await compileNativeUnits({root,metadata,input,output,compiler:resolve(root,'work/downloads/hermes-build/bin/shermes'),ccOpt:'O1',binaryPools:true,run,sha});assert.equal(built.code,0);
const actual=spawnSync(output,[],{encoding:'utf8'});assert.equal(actual.status,0,actual.stderr);
let expected;runInNewContext(chunks.join('\n')+main,{print:text=>{expected=JSON.parse(text);}});
assert.deepEqual(JSON.parse(actual.stdout),expected);
const report={version:1,matched:true,units:built.units.length,binaryPools:true,expected,actual:JSON.parse(actual.stdout),wrapperSha256:built.wrapperSha256,scope:'Cross-unit global bindings, closure identity and mutation, exact function source, Unicode/NUL/lone surrogates; not battle qualification'};
await writeFile(resolve(root,'benchmarks/validation/native-compiler-multi-unit.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
