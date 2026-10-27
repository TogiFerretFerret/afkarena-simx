import {readFile,writeFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const sha=value=>createHash('sha256').update(value).digest('hex');
const helperPath='benchmarks/validation/worker-strong-map-helper.js',helper=await readFile(new URL('../'+helperPath,import.meta.url),'utf8');
const metadata=JSON.parse(await readFile(new URL('../work/native-oracle-warm23-current.js.metadata.json',import.meta.url)));
const name=metadata.usedTableNames.find(name=>!metadata.mutableTables.includes(name));
function realm(){const c=createContext({digest:sha,approvedName:name});runInContext(helper,c);runInContext("var root=JSON.parse('{\"a\":{\"n\":-0},\"array\":[1]}');var __nativeTables=Object.create(null);__nativeTables[approvedName]=root;var membrane=installQualificationTableMembrane({digest:digest});",c);return c;}
const c=realm();
const captured=JSON.parse(runInContext("JSON.stringify((function(){var OriginalMap=Map;Map.prototype.get=function(){throw Error('mutated get');};Map.prototype.has=function(){throw Error('mutated has');};Map.prototype.set=function(){throw Error('mutated set');};Map=function(){throw Error('mutated constructor');};var table=membrane.wrap(root,{name:approvedName}),child=table.a;return{negativeZero:Object.is(child.n,-0),canonical:child===table.a,descriptor:Object.getOwnPropertyDescriptor(table,'a').value===child,clean:membrane.assertClean(),stats:membrane.stats()};})())",c));
assert.equal(captured.negativeZero,true);assert.equal(captured.canonical,true);assert.equal(captured.descriptor,true);assert.equal(captured.clean,true);
const directed=[];
for(const [label,operation] of [
 ['generic-raw-root',"membrane.wrap({a:1},{name:approvedName})"],
 ['unapproved-name',"membrane.wrap(root,{name:'OutsideWorkerLease'})"],
 ['generic-parse',"membrane.parse('{\"a\":1}',{name:approvedName})"],
 ['root-set-replacement',"membrane.wrap(root,{name:approvedName});__nativeTables={};membrane.assertClean()"]
]){
 const context=realm();const observed=JSON.parse(runInContext('JSON.stringify((function(){var rejected=false,sticky=false;try{'+operation+';}catch(e){rejected=!!e.tableMembraneFailure;}try{membrane.assertClean();}catch(e){sticky=!!e.tableMembraneFailure;}return{rejected:rejected,sticky:sticky};})())',context));assert.deepEqual(observed,{rejected:true,sticky:true},label);directed.push({label,...observed});
}
const report={version:1,passed:true,scope:'Small experimental worker-lease/captured-Map identities proof only; full20 battle report parity is a separate gate.',qualifiesFor10000Target:false,helper:{file:helperPath,sha256:sha(helper)},toolSha256:sha(await readFile(import.meta.filename)),captured,directed};
await writeFile(new URL('../benchmarks/validation/worker-strong-map-lease.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
