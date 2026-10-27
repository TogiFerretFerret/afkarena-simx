import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {parse} from '@babel/parser';
import traverse from '@babel/traverse';
import {staticName} from './source-index.mjs';

// Cache only original immutable source text and positions, never runtime values.
export function extractBootstrapSourceRecords(sources,ordered){
  const definitions=new Map();
  const globals=new Map();
  const functionDeclarations=[];
  const initializers=[];
  const postInitializers=[];
  const sourceGlobalNames=new Set();
  for(const module of ordered){
    const file=`src/srcmodule/${module}`;
    const source=sources.get(file);
    traverse(parse(source),{
      Program(path){for(const name of Object.keys(path.scope.bindings))sourceGlobalNames.add(name);},
      Function(path){
        if(path.isFunctionDeclaration()&&path.parentPath.isProgram())functionDeclarations.push({file,name:path.node.id.name,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end),sha256:createHash('sha256').update(source.slice(path.node.start,path.node.end)).digest('hex')});
        path.skip();
      },
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
        if(file==='src/srcmodule/game_util.js'&&staticName(path.node.callee)==='watchFuncs.forEach')postInitializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(file==='src/srcmodule/game_battle.js'&&staticName(path.node.callee)==='Object.defineProperty'&&staticName(path.node.arguments[0])==='ed'&&path.node.arguments[1]?.type==='StringLiteral'&&path.node.arguments[1].value==='battleEngine')postInitializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
      },
      ForStatement(path){
        if(file==='src/srcmodule/game_battle.js'&&path.parentPath.isProgram()&&path.node.start===190513){
          const body=source.slice(path.node.start,path.node.end);
          assert.equal(createHash('sha256').update(body).digest('hex'),'71bf43e960156ecbcd1d1206d30d11877315a1e057c75a5ca2ded83596d28e54','Source attribute-map initializer changed');
          postInitializers.push({file,start:path.node.start,end:path.node.end,source:body});
        }
      },
      AssignmentExpression(path){
        const name=staticName(path.node.left);
        if(name==='window.EventConfig'&&path.node.operator==='=')initializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(file==='src/srcmodule/game_util.js'&&path.node.left.type==='MemberExpression'&&path.node.left.computed&&staticName(path.node.left.object)==='ed.state_to_string')postInitializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(file==='src/srcmodule/game_battle.js'&&path.node.left.type==='MemberExpression'&&path.node.left.computed&&['CandleDog.BASIC_IMPACT_EFF','CandleDog.BASIC_IMPACT_SOUND'].includes(staticName(path.node.left.object)))postInitializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(name==='window.random_seed'&&path.node.operator==='=')initializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(/^(String|Array|Number)\.prototype\./.test(name??'')&&path.node.operator==='=')initializers.push({file,start:path.node.start,end:path.node.end,source:source.slice(path.node.start,path.node.end)});
        if(path.node.operator!=='='||!name?.includes('.')||/^(String|Array|Number|window)\./.test(name))return;
        const record={file,start:path.node.right.start,end:path.node.right.end,source:source.slice(path.node.right.start,path.node.right.end)};
        if(!definitions.has(name))definitions.set(name,[]);
        definitions.get(name).push(record);
      },
    });
  }
  return {definitions:[...definitions],globals:[...globals],functionDeclarations,initializers,postInitializers,sourceGlobalNames:[...sourceGlobalNames]};
}
