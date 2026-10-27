import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createContext,runInContext} from 'node:vm';
const root=resolve(import.meta.dirname,'..'),revision='c0324ad511b7e327a597d9a0d27e5a7d9f4fbc07';
const upstream=[['CCNode','cocos2d/core/base-nodes/CCNode.js'],['CCSkeleton','extensions/spine/CCSkeleton.js'],['Spine','extensions/spine/Spine.js']];
const expected={CCNode:'35595642ea237cf69b3d1bbc0d39b2133b910136b8d01254b4c82c97c4bdd1ef',CCSkeleton:'ba4da31cc6d33fca3550e114422ce1da0f13840594ffccee8e2dd6ac9fb7d4e7',Spine:'7548ab30126cbf5d449b584654c7bcae4506c102050954cb1feaca62471e32e4'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),vendor={};
for(const[name,path]of upstream){
 const url=`https://raw.githubusercontent.com/cocos2d/cocos2d-html5/${revision}/${path}`,cache=resolve(root,`work/pinned-${name}.js`);
 let bytes;try{bytes=await readFile(cache);}catch(error){if(error.code!=='ENOENT')throw error;const response=await fetch(url);assert.equal(response.status,200);bytes=Buffer.from(await response.arrayBuffer());await writeFile(cache,bytes);}
 assert.equal(sha(bytes),expected[name],`Pinned upstream bytes changed: ${url}`);
 vendor[name]={url,sha256:sha(bytes),source:bytes.toString('utf8')};
}
function excerpt(name,startText,endText){const source=vendor[name].source,start=source.indexOf(startText),end=source.indexOf(endText,start)+endText.length;assert.ok(start>=0&&end>start);const text=source.slice(start,end);return{url:vendor[name].url,start,end,sha256:sha(text),source:text};}
const excerpts={
 setAdditionalTransform:excerpt('CCNode','    setAdditionalTransform: function (additionalTransform) {','\n    },'),
 setSkin:excerpt('CCSkeleton','    setSkin: function (skinName) {','\n    },'),
 setSkinByName:excerpt('Spine','\t\tSkeleton.prototype.setSkinByName = function (skinName) {','\n\t\t};'),
 skeletonSetSkin:excerpt('Spine','\t\tSkeleton.prototype.setSkin = function (newSkin) {','\n\t\t};'),
 attachAll:excerpt('Spine','\t\tSkin.prototype.attachAll = function (skeleton, oldSkin) {','\n\t\t};'),
};
assert.equal(vendor.CCNode.source.includes('setTransform'),false);
const files=[];async function walk(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=resolve(path,entry.name);if(entry.isDirectory())await walk(file);else if(entry.name.endsWith('.js'))files.push(file);}}await walk(resolve(root,'src'));
const sourceInputs={},transformReferences=[];
for(const path of files.sort()){
 const bytes=await readFile(path),source=bytes.toString('utf8'),file=path.slice(root.length+1);sourceInputs[file]=sha(bytes);
 let offset=-1;while((offset=source.indexOf('setTransform',offset+1))!==-1)transformReferences.push({file,offset,context:source.slice(Math.max(0,offset-75),offset+150)});
 // This is a bounded literal-name audit. Computed properties/native extensions
 // are unresolved; the absence of source cannot establish their semantics.
 assert.equal(/setTransform\s*[:=]\s*function|(?:['"]setTransform['"])\s*[:,]/.test(source),false,`Found an implementation to investigate in ${file}`);
}
const context=createContext({});runInContext(vendor.Spine.source,context,{filename:vendor.Spine.url});
const probes=runInContext(`(function(){
 var oldSkin=new spine.Skin('old'),newSkin=new spine.Skin('new');
 var oldAttachment={name:'old'},newAttachment={name:'new'},unrelated={name:'unrelated'};
 oldSkin.addAttachment(0,'body',oldAttachment);newSkin.addAttachment(0,'body',newAttachment);
 var attachment=oldAttachment,writes=0;
 var slot={data:{attachmentName:'body'},getAttachment:function(){return attachment;},setAttachment:function(value){writes++;attachment=value;}};
 var skeleton=Object.create(spine.Skeleton.prototype);
 skeleton.data=new spine.SkeletonData();skeleton.data.skins=[oldSkin,newSkin];skeleton.slots=[slot];skeleton.skin=oldSkin;
 var missingError=null;try{skeleton.setSkinByName('absent');}catch(error){missingError=error.message;}
 var missingPreserved=skeleton.skin===oldSkin&&attachment===oldAttachment&&writes===0;
 skeleton.setSkinByName('new');
 var changed=skeleton.skin===newSkin&&attachment===newAttachment&&writes===1;
 skeleton.skin=oldSkin;attachment=unrelated;writes=0;skeleton.setSkinByName('new');
 var unrelatedPreserved=attachment===unrelated&&writes===0;
 skeleton.setSkin(null);
 return{missingError:missingError,missingPreserved:missingPreserved,matchingAttachmentReplacedByIdentity:changed,unrelatedAttachmentPreserved:unrelatedPreserved,nullSkinPreservesAttachment:skeleton.skin===null&&attachment===unrelated&&writes===0};
})()`,context);
assert.equal(probes.missingError,'Skin not found: absent');for(const[key,value]of Object.entries(probes))if(key!=='missingError')assert.equal(value,true,key);
sourceInputs['tools/audit-render-api-gaps.mjs']=sha(await readFile(resolve(root,'tools/audit-render-api-gaps.mjs')));
const resources={};for(const file of ['src/res/spine.json','src/res/hero.json']){const bytes=await readFile(resolve(root,file));resources[file]={sha256:sha(bytes),firstEntry:Object.entries(JSON.parse(bytes)).slice(0,1)};}
const assets=[];async function findAssets(path){for(const entry of await readdir(path,{withFileTypes:true})){const file=resolve(path,entry.name);if(entry.isDirectory())await findAssets(file);else if(/\.(skel|atlas|cha|plist)$/.test(entry.name))assets.push(file.slice(root.length+1));}}await findAssets(resolve(root,'src'));
const report={version:1,kind:'source-bound-render-api-gap-audit',revision,upstream:Object.fromEntries(Object.entries(vendor).map(([name,{url,sha256}])=>[name,{url,sha256}])),excerpts,sourceInputs,sourceJavaScriptFiles:files.length,transformReferences,resourceMaps:resources,suppliedSkeletonAtlasChaPlistFiles:assets,
 probes:{kind:'Directed fixtures executing complete pinned upstream Spine.js, not synthetic gameplay assets',...JSON.parse(JSON.stringify(probes))},
 decisions:{setTransform:{implemented:false,reason:'No setTransform method exists in pinned upstream CCNode, and supplied JS contains only literal calls. setAdditionalTransform retains the supplied matrix reference and marks render state dirty; substituting it does not prove setTransform replacement/composition, aliasing, return, decomposition or dirty-flag semantics. Original native/custom extension is needed.'},setSkin:{implemented:false,reason:'Pinned original implementation searches actual skeleton skins, throws on missing names, and updates slot attachments by object identity. Filename resource maps and AnimDuration do not supply skin/slot/attachment data; storing only a skin name would omit observable semantics.'}},
 limitations:['Pinned provisional Cocos revision is not proven to be the original game engine revision.','Literal-name absence cannot exclude computed/native definitions.','Directed Spine fixtures prove why a name-only stub is unsafe, not full original native Spine equivalence.'],qualifiesForWholeBattleFidelity:false,qualifiesForBattleThroughputTarget:false};
const output=resolve(root,'benchmarks/validation/render-api-gaps.json');await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,sourceJavaScriptFiles:files.length,transformReferences:transformReferences.length,assets:assets.length,probes:report.probes,decisions:report.decisions}));
