import{readFile,writeFile,mkdir}from'node:fs/promises';
import{resolve}from'node:path';
import{pathToFileURL}from'node:url';
import{spawnSync}from'node:child_process';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{compileSource}from'./compile.mjs';
const root=resolve(import.meta.dirname,'../..'),sha=b=>createHash('sha256').update(b).digest('hex');
const beforeRef='095cbe3^',directory=resolve(root,'work/block-env-before');await mkdir(directory,{recursive:true});
const inputs={};for(const name of ['compile.mjs','expressions.mjs','bindings.mjs','statements.mjs']){const file='tools/rust-port/'+name,bytes=await readFile(resolve(root,file));inputs[file]=sha(bytes);let previous=bytes;if(name==='statements.mjs'){const result=spawnSync('git',['show',beforeRef+':'+file],{cwd:root,maxBuffer:4*1024*1024});assert.equal(result.status,0,result.stderr.toString());previous=result.stdout;}await writeFile(resolve(directory,name),previous);}
const before=await import(pathToFileURL(resolve(directory,'compile.mjs')).href),manifest=JSON.parse(await readFile(resolve(root,'crates/generated-battle/manifest.json'),'utf8'));
const rows=[];for(const item of manifest.modules){const text=(await readFile(resolve(root,item.source.file),'utf8')).slice(item.source.start,item.source.end);assert.equal(sha(text),item.source.sha256);const options={mode:'function',filename:item.source.file+'#'+item.name,allowUnsupported:false};const a=before.compileSource(text,options),b=compileSource(text,options);const count=result=>(result.rust.match(/rt\.child_block_env\(/g)??[]).length;rows.push({name:item.name,source:item.source,functions:b.manifest.functions.length,beforeBlockEnvironmentInstructions:count(a),afterBlockEnvironmentInstructions:count(b),elidedInstructions:count(a)-count(b)});}
for(const[file,digest]of Object.entries(inputs))assert.equal(sha(await readFile(resolve(root,file))),digest,'Compiler changed during assessment');
assert.ok(rows.every(row=>row.elidedInstructions>=0));assert.ok(rows.some(row=>row.name==='ed.Unit.update'&&row.elidedInstructions>0));
const result={version:1,passed:true,beforeStatementsRef:beforeRef,otherCompilerModulesIdentical:true,sourceUnchanged:true,inputs,rows,qualifiesFor10000Target:false,scope:'Static counts of explicit child_block_env allocation instructions in generated original game methods, using identical compiler modules except statements.mjs. This records removed allocation sites, not dynamic allocation counts, peak memory or battle throughput. Loop execution multiplies site counts; paths may remain unexecuted. Function/catch/lexical-loop allocations are retained. Exact source semantic gates are separate.'};const file='benchmarks/validation/rust-empty-block-environment-assessment.json';await writeFile(resolve(root,file),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({file,rows}));
