import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInContext} from 'node:vm';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const functions={
  addEffect:[4345851,4346117],playEffectOnScene:[4346287,4346679],
  addNode:[4348645,4348932],removeEffectNode:[4345391,4345650],removeEffect:[4346131,4346268],
  addActorGroup:[4344969,4345373],playExtensibleChain:[4350366,4350474],
};

/** Build a portable ordinary-JS initializer. Node VM and AOT execute THIS SAME
 * source, including original scene method bodies and original JSON resource
 * text. No guessed effect geometry or animation durations are inserted.
 */
export async function installBootstrapRenderScene(runtime){
  const sourceFile='src/srcmodule/game_ui_1.js';
  const original=await readFile(resolve(root,sourceFile),'utf8');
  const methods=[],records=[];
  for(const[name,[start,end]]of Object.entries(functions)){
    const body=original.slice(start,end);
    if(!body.startsWith('function'))throw new Error(`Invalid original render method location: ${name}`);
    methods.push(`${JSON.stringify(name)}:${body}`);
    records.push({name,file:sourceFile,start,end,sha256:createHash('sha256').update(body).digest('hex')});
  }
  const resources={},resourceStatements=[];
  for(const[name,file]of Object.entries({spine_json:'spine.json',hero_json:'hero.json',effect_json:'effect.json'})){
    const text=await readFile(resolve(root,'src/res',file),'utf8');
    resources[name]={file:`src/res/${file}`,sha256:createHash('sha256').update(text).digest('hex')};
    resourceStatements.push(`ed[${JSON.stringify(name)}]=JSON.parse(${JSON.stringify(text)});bootstrapHost.render.registerAsset(${JSON.stringify(`res/${file}`)},ed[${JSON.stringify(name)}]);`);
  }
  const cacheInit=(runtime.sourceRecords.definitions.get('cc.pFcaInfos')??[]).map(record=>`cc.pFcaInfos=(${record.source});`).join('\n');
  const source=`(function __installOracleRenderScene(__scene){
${cacheInit}
var __methods={${methods.join(',\n')}};
for(var __name in __methods)__scene[__name]=__methods[__name];
__scene.effect_list=[];__scene.actor_list=[];__scene.scale3ChainEntityList=[];__scene.needFlipScene=false;
var __layers=['bottom','main','top','ui','text','num'];
for(var __i=0;__i<__layers.length;__i++)__scene['layer_'+__layers[__i]]=new cc.Node();
ed.fullBtScene=__scene;
${resourceStatements.join('\n')}
var __durations=ed.getDataTable('AnimDuration');
for(var __key in ed.spine_json){
 var __row=ed.spine_json[__key],__clips=__durations[__key+'.cha'],__animations;
 if(__clips){__animations={};for(var __action in __clips)__animations[__action]={duration:__clips[__action].Duration};}else __animations=undefined;
 bootstrapHost.render.registerAsset('res/fca/effect/'+__row.skel,{source:'src/res/spine.json',key:__key,kind:'skeleton',animations:__animations});
 bootstrapHost.render.registerAsset('res/fca/effect/'+__row.atlas,{source:'src/res/spine.json',key:__key,kind:'atlas',animations:__animations});
 var __images=__row.img||[];for(var __j=0;__j<__images.length;__j++)bootstrapHost.render.registerAsset('res/fca/effect/'+__images[__j],{source:'src/res/spine.json',key:__key,kind:'texture'});
}
for(var __hero in ed.hero_json)if(Array.isArray(ed.hero_json[__hero])){
 var __heroClips=__durations[__hero+'.cha'],__heroAnimations;
 if(__heroClips){__heroAnimations={};for(var __heroAction in __heroClips)__heroAnimations[__heroAction]={duration:__heroClips[__heroAction].Duration};}else __heroAnimations=undefined;
 var __files=ed.hero_json[__hero];for(var __k=0;__k<__files.length;__k++)bootstrapHost.render.registerAsset('res/fca/hero/'+__files[__k],{source:'src/res/hero.json',key:__hero,animations:__heroAnimations});
}
ed.battleVFXFilter.init();
return __scene;
})`;
  const install=runInContext(source,runtime.context,{filename:'source-backed-render-scene-initializer.js'});
  const scene=install(runtime.callbacks.sceneHost);
  runtime.renderScene={scene,functions:records,resources,source,sha256:createHash('sha256').update(source).digest('hex')};
  return runtime.renderScene;
}
