import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'work/mutable-parameter-components'),sha=b=>createHash('sha256').update(b).digest('hex'),file=process.argv[2];
assert.ok(file?.endsWith('.json'),'Pass completed component report');
const report=JSON.parse(await readFile(resolve(root,file))),prepArtifact=report.artifacts.find(a=>a.file.endsWith('.preparation.gz')),prep=JSON.parse(gunzipSync(await readFile(resolve(root,prepArtifact.file))));
const files={};
async function save(path,absolute=resolve(root,path)){const bytes=await readFile(absolute);files[path]={sha256:sha(bytes),bytes:bytes.length,base64:bytes.toString('base64')};}
async function tree(dir){for(const e of await readdir(resolve(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())await tree(p);else if(p.endsWith('.rs'))await save(p);}}
for(const name of Object.keys(prep.compiled)){const path=name+'.rs',bytes=await readFile(resolve(work,path));assert.equal(sha(bytes),prep.compiled[name].sha256);await save('generated/'+path,resolve(work,path));await save('generated/'+name+'.counted.rs',resolve(work,name+'.counted.rs'));await save('generated/'+name+'.utf16le',resolve(work,name+'.utf16le'));}
for(const [kind,b]of Object.entries(prep.binaries)){const bytes=await readFile(resolve(work,kind+'.rs'));assert.equal(sha(bytes),b.driverSha256,'Can seal only the exact current build drivers');assert.equal(sha(await readFile(b.file)),b.sha256);await save('generated/'+kind+'.rs',resolve(work,kind+'.rs'));}
for(const e of await readdir(resolve(root,'tools/rust-port'),{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.mjs'))await save('tools/rust-port/'+e.name);
await tree('crates/js-runtime/src');await tree('crates/battle-core/src');
for(const p of ['config/source-oracle-runtime.json','crates/js-runtime/Cargo.toml','crates/battle-core/Cargo.toml','Cargo.toml','Cargo.lock'])await save(p);
const raw=Buffer.from(JSON.stringify(files)),compressed=gzipSync(raw,{level:9}),archive=file.replace(/\.json$/,'.generated-inputs.gz');await writeFile(resolve(root,archive),compressed);
report.artifacts.push({file:archive,sha256:sha(compressed),uncompressedSha256:sha(raw),uncompressedBytes:raw.length,files:Object.keys(files).length});
report.buildInputs=Object.fromEntries(Object.entries(files).map(([path,v])=>[path,{sha256:v.sha256,bytes:v.bytes}]));
report.scope=report.scope.replace('originaltable/copy/data/getDuration helpers and explicitowner/caster data','originaltable/copy/data helpers and explicitgetDuration/owner/caster fixture callbacks');
report.admission=Object.fromEntries(['off','on'].map(v=>{const f=prep.compiled['buff_'+v].manifest.functions.find(f=>f.sourceSha256===prep.ctorSource.sourceSha256);return[v,{sourceSha256:f.sourceSha256,nativeMutableParameters:f.nativeMutableParameters,mirroredMutableParameters:f.mirroredMutableParameters,nativeActivationElided:f.nativeActivationElided}]}));
await writeFile(resolve(root,file),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({file,archive,files:Object.keys(files).length}));
