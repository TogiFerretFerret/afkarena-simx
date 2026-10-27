import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');

/** Headless adapter for these two simple data classes only.
 * All methods/factories/getters are original source. Cocos class/instance metadata
 * is excluded; no superclass emulation is provided. See manifest domain.
 */
export async function installBootstrapDataClasses(context){
  const manifest=JSON.parse(await readFile(resolve(root,'config/bootstrap-data-classes.json'),'utf8'));
  const sources=new Map();
  for(const record of manifest.records){
    if(!sources.has(record.file))sources.set(record.file,await readFile(resolve(root,record.file),'utf8'));
    const body=sources.get(record.file).slice(record.start,record.end);
    assert.equal(createHash('sha256').update(body).digest('hex'),record.sha256,`Stale source: ${record.name}`);
    const value=runInContext(`(${body})`,context,{filename:`${record.file}:${record.start}`});
    const parts=record.name.split('.');let owner=context;
    for(const key of parts.slice(0,-1)){
      if(!owner[key])throw new Error(`Missing namespace for ${record.name}`);
      owner=owner[key];
    }
    if(record.kind==='class_properties'){
      assert.equal(typeof value.ctor,'function');
      assert.ok(!value.ctor.toString().includes('_super'),'Superclass construction requires actual Cocos runtime');
      const Constructor=value.ctor;
      Constructor.prototype=value;
      Object.defineProperty(value,'constructor',{value:Constructor,writable:true,configurable:true});
      owner[parts.at(-1)]=Constructor;
    }else owner[parts.at(-1)]=value;
  }
  return manifest.domain;
}
