import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContext,runInContext } from 'node:vm';
test('declared mutable table keeps original identity and full mutable root; other writes remain sticky errors',async()=>{
 const context=createContext({digest:text=>createHash('sha256').update(text).digest('hex')});
 for(const file of ['qualification-table-membrane.js','qualification-table-policy.js'])runInContext(await readFile(new URL('../'+file,import.meta.url),'utf8'),context);
 const result=runInContext(`(function(){var policy=installQualificationTablePolicy({digest:digest,mutableTables:['Mutable']}),raw={row:{Type:'before'}},table=policy.wrap(raw,{name:'Mutable'}),fixed=policy.wrap({row:{x:1}},{name:'Fixed'});table.row.Type='after';var same=table===raw&&policy.mutableRoots().Mutable.row===raw.row&&policy.mutableRoots().Mutable.row.Type==='after';var denied=false,sticky=false;try{fixed.row.x=2}catch(e){denied=!!e.tableMembraneFailure}try{policy.assertClean()}catch(e){sticky=!!e.tableMembraneFailure}return{same:same,denied:denied,sticky:sticky,unchanged:fixed.row.x===1,metadata:policy.immutableMetadata};})()`,context);
 assert.equal(result.same,true);assert.equal(result.denied,true);assert.equal(result.sticky,true);assert.equal(result.unchanged,true);
});
