import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {compileSource} from './compile.mjs';
import {prototypeBuffFixture,resetBuffApplySource,addBuffSource} from './prototype-buff-fixture.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const pins=new Set([sha(resetBuffApplySource),sha(addBuffSource)]),rows=[];
function check(name,source,enabled,expected){const compiled=compileSource(source,{allowUnsupported:false,sourceSpecializations:enabled}),hinted=compiled.manifest.functions.filter(f=>f.prototypeLiteralHintSource),sites=(compiled.rust.match(/LiteralReadSite::new_with_prototype_hint\(/g)??[]).length;
 assert.equal(hinted.length>0,expected,name);assert.equal(sites>0,expected,name);
 for(const fn of hinted){const owner=fn.prototypeLiteralHintSource;assert.ok(pins.has(owner.sourceSha256));assert.equal(sha(source.slice(owner.start,owner.end)),owner.sourceSha256);assert.ok(fn.start>=owner.start&&fn.end<=owner.end);}
 rows.push({name,sourceSha256:sha(source),enabled,sites,hintedFunctions:hinted.map(f=>({id:f.id,start:f.start,end:f.end,proof:f.prototypeLiteralHintSource}))});return compiled;}
check('exact-original-buff-fixture',prototypeBuffFixture,true,true);
check('specializations-disabled',prototypeBuffFixture,false,false);
for(const[name,source]of[['reset',resetBuffApplySource],['add',addBuffSource]]){check(name+'-exact','var original='+source+';',true,true);const changed=source.replace(/function\s*\(/,'function /* different source pin */(');assert.notEqual(changed,source);check(name+'-same-semantics-different-source','var original='+changed+';',true,false);}
check('unrelated-read-sites','function read(o){return o.x+o.method();}',true,false);
const files=['tools/rust-port/compile.mjs','tools/rust-port/expressions.mjs','tools/rust-port/check-source-selective-prototype.mjs','tools/rust-port/prototype-buff-fixture.mjs','crates/js-runtime/src/property_slots.rs'],inputs={};for(const file of files)inputs[file]=sha(await readFile(new URL('../../'+file,import.meta.url)));
const report={version:1,passed:true,scope:'Static generated-site selection only. Exact frozen Buff source ancestors authorize optional guarded prototype probing; all other sites invoke the ordinary const-false entry. Runtime semantic differential evidence is separate.',rows,inputs};await mkdir(new URL('../../benchmarks/validation/',import.meta.url),{recursive:true});await writeFile(new URL('../../benchmarks/validation/rust-source-selective-prototype.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:true,rows:rows.map(r=>({name:r.name,sites:r.sites,hintedFunctions:r.hintedFunctions.length}))}));
