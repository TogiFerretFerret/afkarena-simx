import test from 'node:test';
import assert from 'node:assert/strict';
import { indexSource, staticName } from '../source-index.mjs';

test('retains dynamic dispatch uncertainty and exact function ownership', () => {
  const source = `ed.Unit = cc.Class.extend({
    update: function(dt) { this.tick(dt); callback(function() { rng.next(); }); obj[key](); },
    ['cast']: function() { obj['fixed'](); }
  });`;
  const result = indexSource(source, 'fixture.js');
  assert.equal(result.classCandidates[0].name, 'ed.Unit');
  assert.equal(result.classCandidates[0].base, 'cc.Class');
  const update = result.functions.find(f => f.name === 'ed.Unit.update');
  const nested = result.functions.find(f => f.parent === update.id);
  assert.equal(result.calls.find(c => c.callee === 'rng.next').owner, nested.id);
  assert.equal(result.calls.find(c => c.callee === 'this.tick').owner, update.id);
  assert.ok(result.calls.some(c => c.callee === null && c.owner === update.id));
  assert.ok(result.calls.every(c => c.resolution === 'unresolved'));
  assert.ok(result.functions.some(f => f.name === 'ed.Unit.cast'));
  assert.equal(source.slice(update.start, update.end).startsWith('function(dt)'), true);
});

test('computed identifier class keys cannot be treated as static method names', () => {
  const result = indexSource('ed.C = cc.Class.extend({ [key]: function() {} });', 'fixture.js');
  assert.equal(result.functions[0].name, null);
  assert.equal(staticName({ type: 'CallExpression' }), null);
});

test('fails closed on malformed source', () => {
  assert.throws(() => indexSource('function broken(', 'bad.js'));
});
