import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'work/native-unit-layout');
await mkdir(directory,{recursive:true});
function run(command,args){const result=spawnSync(command,args,{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result.stdout;}
const compiler=resolve(root,'work/downloads/hermes-build/bin/shermes'),js=resolve(directory,'source.js'),cfile=resolve(directory,'source.c');
await writeFile(js,'var input={number:3};print(input.number);\n');
run(compiler,['-O','-emit-c',js,'-o',cfile]);
let c=await readFile(cfile,'utf8');assert.ok(c.includes('unit_data->unit = (SHUnit){'),'Compiler must initialize the header only');
const entries=1048576;
c=c.replace(/SHReadPropertyCacheEntry read_prop_cache_data\[\d+\]/,`SHReadPropertyCacheEntry read_prop_cache_data[${entries}]`)
 .replace(/\.num_read_prop_cache_entries\s*=\s*\d+/,`.num_read_prop_cache_entries = ${entries}`)
 .replace('int main(int argc, char **argv) {','int unused_source_main(int argc, char **argv) {');
c+=`\n#include <stdio.h>
_Static_assert(offsetof(struct UnitData,unit)==0,"SHUnit must lead UnitData");
int main(void) {
  struct UnitData *data=(struct UnitData *)CREATE_THIS_UNIT();
  if(!data)return 1;
  if(data->unit.symbols!=data->symbol_data||data->unit.write_prop_cache!=data->write_prop_cache_data||data->unit.read_prop_cache!=data->read_prop_cache_data||data->unit.private_name_cache!=data->private_name_cache_data||data->unit.object_literal_class_cache!=data->object_literal_class_cache)return 2;
  if(data->unit.num_read_prop_cache_entries!=${entries}||*data->unit.index!=0)return 3;
  for(size_t i=sizeof(SHUnit);i<sizeof(struct UnitData);i++)if(((unsigned char *)data)[i]!=0)return 4;
  data->unit.read_prop_cache[${entries}-1].clazz=17;
  if(data->read_prop_cache_data[${entries}-1].clazz!=17)return 5;
  printf("{\\"headerBytes\\":%zu,\\"unitBytes\\":%zu,\\"zeroedTailBytes\\":%zu,\\"cacheEntries\\":%u,\\"headerPointersAliasTail\\":true}\\n",sizeof(SHUnit),sizeof(struct UnitData),sizeof(struct UnitData)-sizeof(SHUnit),data->unit.num_read_prop_cache_entries);
  free(data);return 0;
}
`;
const patched=resolve(directory,'layout.c'),object=resolve(directory,'layout.o'),binary=resolve(directory,'layout');await writeFile(patched,c);
const config=JSON.parse(await readFile(resolve(root,'config/native-compiler-static-hermes.json'),'utf8')),build=resolve(root,'work/downloads/hermes-build');
const include=resolve(root,'work/downloads',config.source.directory,'include');
run('cc',['-c','-O0','-g0','-fstack-usage','-DNDEBUG','-ffp-contract=off','-I'+resolve(build,'lib/config'),'-I'+include,patched,'-o',object]);
const link=[object];for(const lib of ['lib','jsi','tools/shermes']){const path=resolve(build,lib);link.push('-L'+path,'-Wl,-rpath,'+path);}link.push('-lshermes_console','-lhermesvm','-lm','-o',binary);run('cc',link);
const actual=JSON.parse(run(binary,[])),usage=await readFile(resolve(directory,'layout.su'),'utf8');
const constructorStackBytes=Number(/:sh_export_this_unit\t(\d+)\t/.exec(usage)?.[1]);
assert.ok(constructorStackBytes>0&&constructorStackBytes<=1024,'Constructor stack must be bounded independently of cache storage');
assert.ok(actual.zeroedTailBytes>8*1024*1024,'Regression must exceed the original default native stack');
const report={version:1,matched:true,ccOpt:'O0',defaultStackExecution:true,...actual,constructorStackBytes,compilerSha256:createHash('sha256').update(await readFile(compiler)).digest('hex'),scope:'Actual generated constructor with 1,048,576 read-cache entries: header pointers/counts preserved, entire >8MiB tail initially zero, last entry aliases header cache pointer, native creator stack <=1KiB.'};
await writeFile(resolve(root,'benchmarks/validation/native-unit-header-layout.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
