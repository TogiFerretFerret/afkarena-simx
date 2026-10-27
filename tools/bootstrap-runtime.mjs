import { readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createContext, runInContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import { staticName } from './source-index.mjs';
import { loadBootstrapTableSync } from './bootstrap-source.mjs';

const root=resolve(import.meta.dirname,'..');

/** Diagnostic source loader, not a validated module-loading order.
 * Original RHS expressions are evaluated on demand. Required lexical closures,
 * module side effects and dynamic property names fail rather than being invented.
 */
export async function createBootstrapRuntime(){
  const definitions=new Map();
  const globals=new Map();
  const initializers=[];
  const postInitializers=[];
  const modules=(await readdir(resolve(root,'src/srcmodule'))).filter(file=>file.endsWith('.js')).sort();
  const ordered=['game_util.js','game_battle.js',...modules.filter(file=>!['game_util.js','game_battle.js'].includes(file))];
  for(const module of ordered){
    const file=`src/srcmodule/${module}`;
    const source=await readFile(resolve(root,file),'utf8');
    traverse(parse(source),{
      Function(path){path.skip();},
      VariableDeclaration(path){
        if(path.scope.block.type==='Program')for(const declaration of path.node.declarations){
          if(declaration.id.type==='Identifier'&&declaration.init){
            const name=declaration.id.name;
            if(!globals.has(name))globals.set(name,[]);
            globals.get(name).push({file,start:declaration.init.start,end:declaration.init.end,source:source.slice(declaration.init.start,declaration.init.end)});
          }
        }
        if(path.scope.block.type==='Program'&&path.node.declarations.some(d=>['multiplier','moder'].includes(d.id.name))){
          initializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        }
      },
      CallExpression(path){
        if(staticName(path.node.callee)==='ed.switchUnitRebuild')postInitializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
      },
      AssignmentExpression(path){
        const name=staticName(path.node.left);
        if(name==='window.random_seed'&&path.node.operator==='=')initializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(/^(String|Array|Number)\.prototype\./.test(name??'')&&path.node.operator==='=')initializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(path.node.operator!=='='||!name?.includes('.')||/^(String|Array|Number|window)\./.test(name))return;
        const record={file,start:path.node.right.start,end:path.node.right.end,source:source.slice(path.node.right.start,path.node.right.end)};
        if(!definitions.has(name))definitions.set(name,[]);
        definitions.get(name).push(record);
      },
    });
  }
  const tables=new Map();
  const loaded=[],active=new Set();
  const cc={game:{config:null,CONFIG_KEY:{}},Node:function Node(){},error:(...args)=>{throw new Error(args.join(' '));}};
  const ed={};
  const context=createContext({ed,cc,window:{},HTMLElement:function HTMLElement(){},console,
    clientCall:()=>{},
  });
  context.window=context;
  for(const initializer of initializers)runInContext(initializer.source,context,{filename:`${initializer.file}:${initializer.start}`});
  const provenance=JSON.parse(await readFile(resolve(root,'config/bootstrap-cocos-runtime.json'),'utf8'));
  const cocos=await readFile(resolve(root,provenance.file),'utf8');
  assert.equal(createHash('sha256').update(cocos).digest('hex'),provenance.sha256);
  runInContext(cocos,context,{filename:provenance.file});
  function expose(owner,prefix){
    const keys=new Set([...definitions.keys()].filter(name=>name.startsWith(prefix+'.')).map(name=>name.slice(prefix.length+1).split('.')[0]));
    for(const key of keys){
      const name=`${prefix}.${key}`;
      if(key in owner){
        const descriptor=Object.getOwnPropertyDescriptor(owner,key);
        if(descriptor&&'value'in descriptor&&descriptor.value&&(typeof descriptor.value==='object'||typeof descriptor.value==='function'))expose(descriptor.value,name);
        continue;
      }
      Object.defineProperty(owner,key,{configurable:true,enumerable:true,get(){
        if(active.has(name))throw new Error(`Source dependency cycle at ${name}`);
        const records=definitions.get(name);
        if(!records)throw new Error(`Missing original parent definition: ${name}`);
        active.add(name);
        let value;
        try{
          for(const record of records){
            // Make previous definitions visible to source wrappers such as ed.override.
            Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value});
            value=runInContext(`(${record.source})`,context,{filename:`${record.file}:${record.start}`});
          }
          Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value});
          if(value&&(typeof value==='object'||typeof value==='function'))expose(value,name);
          loaded.push(name);return value;
        }finally{active.delete(name);}
      },set(value){Object.defineProperty(owner,key,{configurable:true,enumerable:true,writable:true,value});}});
    }
  }
  expose(ed,'ed');
  for(const[name,records]of globals){
    if(name in context)continue;
    Object.defineProperty(context,name,{configurable:true,enumerable:true,get(){
      if(active.has(name))throw new Error(`Source global dependency cycle at ${name}`);
      active.add(name);
      let value;
      try{
        for(const record of records){
          Object.defineProperty(context,name,{configurable:true,enumerable:true,writable:true,value});
          value=runInContext(`(${record.source})`,context,{filename:`${record.file}:${record.start}`});
        }
        Object.defineProperty(context,name,{configurable:true,enumerable:true,writable:true,value});
        if(value&&(typeof value==='object'||typeof value==='function'))expose(value,name);
        loaded.push(name);return value;
      }finally{active.delete(name);}
    },set(value){Object.defineProperty(context,name,{configurable:true,enumerable:true,writable:true,value});}});
  }
  ed.getDataTable=name=>{if(!tables.has(name))tables.set(name,loadBootstrapTableSync(name));return tables.get(name);};
  ed.logbugly=message=>{throw new Error(message);};
  for(const initializer of postInitializers)runInContext(initializer.source,context,{filename:`${initializer.file}:${initializer.start}`});
  return {context,ed,loaded,tables,provenance,initializers:initializers.map(({source,...record})=>record),
    limitations:['Lazy symbol evaluation is diagnostic and does not establish original module side-effect order','clientCall is an explicitly suppressed rendering boundary; callbacks are not executed','Cocos runtime revision is provisional; missing closures/globals fail explicitly']};
}
