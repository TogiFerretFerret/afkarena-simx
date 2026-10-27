import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInContext} from 'node:vm';
import {resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');
const functions={
  updateActor:[4344025,4344422],syncActors:[4344434,4344806],addActor:[4344816,4344954],
  updateEffect:[4345664,4345840],checkDialog:[4343649,4344012],
  addEffect:[4345851,4346117],playEffectOnScene:[4346287,4346679],
  addNode:[4348645,4348932],removeEffectNode:[4345391,4345650],removeEffect:[4346131,4346268],
  addActorGroup:[4344969,4345373],playExtensibleChain:[4350366,4350474],
};

/** Build a portable ordinary-JS initializer. Node VM and AOT execute THIS SAME
 * source, including original scene method bodies and original JSON resource
 * text. No guessed effect geometry or animation durations are inserted.
 */
export async function installBootstrapRenderScene(runtime,{logicalHeroTimeline=false,projectVegelfBodyAttachments=false,recordShaderPrograms=false,initializeLogicalScene=false}={}){
  if(projectVegelfBodyAttachments&&!logicalHeroTimeline)throw new Error('Physical body projection requires the explicit logical main-animation clock');
  const sourceFile='src/srcmodule/game_ui_1.js';
  const original=await readFile(resolve(root,sourceFile),'utf8');
  const methods=[],records=[];
  const selectedFunctions={...functions};
  if(initializeLogicalScene){
    const record=runtime.sourceRecords.definitions.get('ed.battleBaseScene')?.at(-1);
    if(record?.file!==sourceFile)throw new Error('Original base scene definition changed');
    const initStart=record.source.indexOf('initData:function(){this.start_dialog_check')+'initData:'.length;
    const initEnd=record.source.indexOf('},initLayers:',initStart)+1;
    const loadStart=record.source.indexOf('loadRes:function(){this.pauseFlag=!1}')+'loadRes:'.length;
    const loadEnd=loadStart+'function(){this.pauseFlag=!1}'.length;
    if(initStart<'initData:'.length||initEnd<=initStart||loadStart<'loadRes:'.length)throw new Error('Original logical scene initialization proof changed');
    selectedFunctions.initData=[record.start+initStart,record.start+initEnd];
    selectedFunctions.loadRes=[record.start+loadStart,record.start+loadEnd];
  }
  for(const[name,[start,end]]of Object.entries(selectedFunctions)){
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
  let timelineSetup='';
  if(logicalHeroTimeline){
    const record=runtime.sourceRecords.definitions.get('ed.SpineActor')?.at(-1);
    const eventDelegateSource='function(e,t){n.__onAnimationEvent(e,t)}';
    const animationEventSource='function(e,t){var i=t.data;i.name,i.intValue,i.intValue,i.stringValue;this._onEvent&&this._onEvent(e,t)}';
    if(!record?.source.includes(`setEventListener((${eventDelegateSource}))`)||!record.source.includes(`__onAnimationEvent:${animationEventSource}`)||!record.source.includes('n=this;this._skeletonAnimation.setCompleteListener'))throw new Error('Original Spine event-owner/pure-dispatch proof changed');
    const proof={eventDelegateSource,animationEventSource,classSourceSha256:createHash('sha256').update(record.source).digest('hex')};
    const tableSha256=createHash('sha256').update(JSON.stringify(runtime.ed.getDataTable('AnimDuration'))).digest('hex');
    timelineSetup=`var __logicalTimelineProof=${JSON.stringify(proof)},__durationTableSha256=${JSON.stringify(tableSha256)};
var __originalSpineUpdate=ed.SpineActor.prototype.update;
ed.SpineActor.prototype.update=function(elapsed){if(this._skeletonAnimation)this._skeletonAnimation.bindLogicalTimelineOwner(this,__logicalTimelineProof);return __originalSpineUpdate.call(this,elapsed);};
function __clipMetadata(duration,key,action){return{duration:duration,logicalTimeline:{kind:'source-table-f64-v1',eventPolicy:'no-observable-events',source:{table:'AnimDuration',key:key,action:action,sha256:__durationTableSha256}}};}`;
  }else timelineSetup='function __clipMetadata(duration){return{duration:duration};}';
  let bodyProjectionSetup='',bodyProjectionProof,shaderSetup='';
  if(projectVegelfBodyAttachments||recordShaderPrograms){
    const proofText=await readFile(resolve(root,'config/stage-body-attachment-projection.json'),'utf8');
    bodyProjectionProof=JSON.parse(proofText);
    for(const[file,expected]of Object.entries(bodyProjectionProof.sourceFiles)){
      if(createHash('sha256').update(await readFile(resolve(root,file))).digest('hex')!==expected)throw new Error(`Body projection source proof changed: ${file}`);
    }
    for(const[name,expected]of Object.entries(bodyProjectionProof.classes)){
      const actual=runtime.sourceRecords.definitions.get(name)??[];
      if(actual.length!==expected.length||actual.some((record,index)=>record.file!==expected[index].file||record.start!==expected[index].start||record.end!==expected[index].end||createHash('sha256').update(record.source).digest('hex')!==expected[index].sha256))throw new Error(`Body projection class proof changed: ${name}`);
    }
    if(projectVegelfBodyAttachments){
      const leafSource=await readFile(resolve(root,'tools/bootstrap-body-projection.js'),'utf8');
      resources.bodyProjection={file:'tools/bootstrap-body-projection.js',sha256:createHash('sha256').update(leafSource).digest('hex'),proofFile:'config/stage-body-attachment-projection.json',proofSha256:createHash('sha256').update(proofText).digest('hex')};
      bodyProjectionSetup=`(${leafSource})(${JSON.stringify(bodyProjectionProof)});`;
    }
    if(recordShaderPrograms){
      const callbackSource='function(t){t.use(),e.setShaderProgram(t),r.release&&r.release()}';
      const original=runtime.sourceRecords.definitions.get('ed.setNamedShader')?.at(-1)?.source;
      if(!original?.includes(callbackSource))throw new Error('Original shader GPU-only callback proof changed');
      shaderSetup=`bootstrapHost.render.enableRecordedShaders(${JSON.stringify({callbackSource,names:['TimeStopShader','NormalShader']})});`;
    }
  }
  const source=`(function __installOracleRenderScene(__scene){
${cacheInit}
${timelineSetup}
${bodyProjectionSetup}
${shaderSetup}
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
 if(__clips){__animations={};for(var __action in __clips)__animations[__action]=__clipMetadata(__clips[__action].Duration,__key+'.cha',__action);}else __animations=undefined;
 bootstrapHost.render.registerAsset('res/fca/effect/'+__row.skel,{source:'src/res/spine.json',key:__key,kind:'skeleton',animations:__animations});
 bootstrapHost.render.registerAsset('res/fca/effect/'+__row.atlas,{source:'src/res/spine.json',key:__key,kind:'atlas',animations:__animations});
 var __images=__row.img||[];for(var __j=0;__j<__images.length;__j++)bootstrapHost.render.registerAsset('res/fca/effect/'+__images[__j],{source:'src/res/spine.json',key:__key,kind:'texture'});
}
for(var __hero in ed.hero_json)if(Array.isArray(ed.hero_json[__hero])){
 var __heroClips=__durations[__hero+'.cha'],__heroAnimations;
 if(__heroClips){__heroAnimations={};for(var __heroAction in __heroClips)__heroAnimations[__heroAction]=__clipMetadata(__heroClips[__heroAction].Duration,__hero+'.cha',__heroAction);}else __heroAnimations=undefined;
 var __files=ed.hero_json[__hero];for(var __k=0;__k<__files.length;__k++)bootstrapHost.render.registerAsset('res/fca/hero/'+__files[__k],{source:'src/res/hero.json',key:__hero,animations:__heroAnimations});
}
ed.battleVFXFilter.init();
${initializeLogicalScene?'__scene.initData();__scene.loadRes();ed.fpsTracker.init();':''}
return __scene;
})`;
  const install=runInContext(source,runtime.context,{filename:'source-backed-render-scene-initializer.js'});
  const scene=install(runtime.callbacks.sceneHost);
  runtime.renderScene={scene,functions:records,resources,source,sha256:createHash('sha256').update(source).digest('hex'),logicalHeroTimeline,projectVegelfBodyAttachments,recordShaderPrograms,initializeLogicalScene,bodyProjectionProof,
    timelineContract:logicalHeroTimeline?'Opt-in f64 logical clock from exact source AnimDuration values; native Spine float timing/asset-event equivalence is not established. Unknown clips, event handlers and geometry fail closed.':null};
  return runtime.renderScene;
}
