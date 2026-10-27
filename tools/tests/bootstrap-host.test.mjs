import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createContext,runInContext} from 'node:vm';

test('shared Linux device adapter records audio outputs with stable IDs',async()=>{
  const source=await readFile(new URL('../bootstrap-host.js',import.meta.url),'utf8');
  const context=createContext({cc:{}});runInContext(source,context);
  assert.equal(context.cc.sys.os,'Linux');
  const first=context.cc.audioEngine.playEffect('first.ogg',false);
  const second=context.cc.audioEngine.playEffect('second.ogg',true);
  assert.equal(first,1);assert.equal(second,2);
  context.cc.audioEngine.pauseEffect(second);
  assert.equal(context.bootstrapHost.audioState().effects[second].paused,true);
  context.cc.audioEngine.stopEffect(first);
  assert.equal(context.bootstrapHost.audioState().effects[first],undefined);
  assert.equal(context.bootstrapHost.events.length,4);
});
