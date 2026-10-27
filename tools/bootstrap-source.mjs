import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');

/** Evaluate exact original function bodies in a caller-owned VM context.
 * This does not emulate Cocos classes or install arbitrary host dependencies.
 */
export async function loadBootstrapFunctions(context) {
  const manifest=JSON.parse(await readFile(resolve(root,'config/bootstrap-functions.json'),'utf8'));
  const sources=new Map(),functions=new Map();
  for(const record of manifest.functions){
    if(!sources.has(record.file))sources.set(record.file,await readFile(resolve(root,record.file),'utf8'));
    const body=sources.get(record.file).slice(record.start,record.end);
    assert.equal(createHash('sha256').update(body).digest('hex'),record.sha256,`Stale source span: ${record.name}`);
    functions.set(record.name,runInContext(`(${body})`,context,{filename:`${record.file}:${record.start}`}));
  }
  return functions;
}

export async function installBootstrapHelpers(context) {
  const functions=await loadBootstrapFunctions(context);
  for(const [name,fn] of functions){
    if(name.startsWith('ed.BattleEngine.'))continue;
    const parts=name.slice('ed.'.length).split('.');
    if(parts.length>1&&parts[0]!=='battleTools')throw new Error(`Unexpected nested helper: ${name}`);
    let owner=context.ed;
    for(const part of parts.slice(0,-1))owner=owner[part]??=(Object.create(null));
    owner[parts.at(-1)]=fn;
  }
  return functions;
}

/** Read the supplied table format directly; no Cocos loader or network required. */
export async function loadBootstrapTable(name) {
  if(!/^[A-Za-z0-9_]+$/.test(name))throw new Error('Invalid table name');
  for(const directory of ['src/srcmodule','src/csvjson/en']){
    let text;
    try{text=await readFile(resolve(root,directory,`${name}.json`),'utf8');}
    catch(error){if(error.code==='ENOENT')continue;throw error;}
    const value=JSON.parse(text);
    const table=value.ed?.[`${name}Table`];
    if(!table)throw new Error(`Unexpected source table envelope: ${directory}/${name}.json`);
    return table;
  }
  throw new Error(`Missing supplied table: ${name}`);
}

export function loadBootstrapTableSync(name) {
  if(!/^[A-Za-z0-9_]+$/.test(name))throw new Error('Invalid table name');
  for(const directory of ['src/srcmodule','src/csvjson/en']){
    let text;
    try{text=readFileSync(resolve(root,directory,`${name}.json`),'utf8');}
    catch(error){if(error.code==='ENOENT')continue;throw error;}
    let value;
    try{value=JSON.parse(text);}
    catch{throw new Error(`Source table requires packed-config decoder: ${directory}/${name}.json`);}
    const table=value.ed?.[`${name}Table`];
    if(!table)throw new Error(`Unexpected source table envelope: ${directory}/${name}.json`);
    return table;
  }
  throw new Error(`Missing supplied table: ${name}`);
}
