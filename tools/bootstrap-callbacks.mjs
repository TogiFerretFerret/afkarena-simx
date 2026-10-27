import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runInContext } from 'node:vm';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const root=resolve(import.meta.dirname,'..');
const file='src/srcmodule/game_ui_1.js';
const spans={clientCall:[4337876,4337915],resetClientCall:[4337941,4337978],snapshot:[4342606,4343218],onUpdate:[4343228,4343636]};

/** Source-backed local-scene callback phase. Callbacks are queued and drained FIFO
 * AFTER engine.update, including callbacks appended to the captured queue.
 * Replacing ed.clientCall_list does not replace the loop's captured array.
 */
export async function installBootstrapCallbacks(context){
  const source=await readFile(resolve(root,file),'utf8');
  const body=name=>source.slice(...spans[name]);
  assert.equal(body('clientCall'),'function(e){ed.clientCall_list.push(e)}');
  // Locate reset by its actual assignment to avoid depending on delimiter offsets.
  const resetMatch=/resetClientCall=(function\(\)\{ed\.clientCall_list=\[\]\})/.exec(source);
  assert.ok(resetMatch,'Missing original resetClientCall');
  const reset=resetMatch[1];
  runInContext(`clientCall=(${body('clientCall')});resetClientCall=(${reset});`,context,{filename:`${file}:original-clientCall`});
  const onUpdate=body('onUpdate');
  const from=onUpdate.indexOf('ed.clientCallCount=');
  const to=onUpdate.indexOf('this.updateActor',from);
  assert.ok(from>=0&&to>from,'Missing source callback drain boundary');
  const drainBody=onUpdate.slice(from,to);
  assert.ok(drainBody.includes('var t=ed.clientCall_list;t.length>0;'));
  const drain=runInContext(`(function(){${drainBody}})`,context,{filename:`${file}:original-clientCall-drain`});
  const sourceSnapshot=runInContext(`(${body('snapshot')})`,context,{filename:`${file}:${spans.snapshot[0]}`});
  let snapshots=0;
  const sceneHost={snapshot(...args){snapshots++;return sourceSnapshot.apply(this,args)}};
  const provenance={file,functions:Object.fromEntries(Object.entries(spans).filter(([name])=>name!=='resetClientCall').map(([name,[start,end]])=>[name,{start,end,sha256:createHash('sha256').update(source.slice(start,end)).digest('hex')}])),
    resetSha256:createHash('sha256').update(reset).digest('hex'),drainSha256:createHash('sha256').update(drainBody).digest('hex'),
    scope:'Original local-scene queued callback phase; actor/effect/view updates remain outside this adapter'};
  function beginFrame(){context.resetClientCall();}
  function drainCallbacks(){
    snapshots=0;
    drain.call(sceneHost);
    return{queued:context.ed.clientCallCount,executed:snapshots/2,pending:context.ed.clientCall_list.length};
  }
  function updateFrame(elapsed){
    beginFrame();
    context.ed.battleEngine.update(elapsed);
    return drainCallbacks();
  }
  return{beginFrame,drainCallbacks,updateFrame,provenance,sceneHost};
}
