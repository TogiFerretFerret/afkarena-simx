import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '@babel/parser';
import { lowerFunction, emitRust } from '../lower-numeric.mjs';
const lower = (source, types = ['vec2', 'vec2']) => lowerFunction(parseExpression(source), types);

test('retains subtraction, multiplication and addition order as separate operations', () => {
  const ir = lower('function(a,b){var x=a[0]-b[0], y=a[1]-b[1]; return x*x+y*y}');
  assert.deepEqual(ir.operations.filter(o=>o.op==='binary').map(o=>o.operator), ['-', '-', '*', '*', '+']);
  assert.match(emitRust('distance',ir), /-> f64/);
  const rust = emitRust('distance',ir);
  assert.match(rust, /crate::js_math::sub\(v0, v1\)/);
  assert.match(rust, /crate::js_math::mul\(v2, v2\)/);
  assert.match(rust, /crate::js_math::add\(v6, v7\)/);
});

test('rejects effects, implicit coercion, unknown inputs and dynamic indexing', () => {
  for(const source of [
    'function(a,b){return sideEffect(a)}',
    'function(a,b){return a+b}',
    'function(a,b){return a[index]}',
    'function(a,b){a[0]=1; return a[0]}',
    'function(a,b){return missing}',
    'function(a,b){return a[2]}',
    'function(a,b){if(a[0]) return b[0]; return a[0]}',
    'function(a,b){var a=1; return a}',
  ]) assert.throws(()=>lower(source), source);
});

test('array outputs preserve element evaluation order', () => {
  const ir=lower('function(a,b){return [.5*(a[0]+b[0]), .5*(a[1]+b[1])]}');
  assert.equal(ir.result.type,'vec2');
  assert.deepEqual(ir.operations.filter(o=>o.op==='load').map(o=>[o.object,o.index]), [['arg0',0],['arg1',0],['arg0',1],['arg1',1]]);
});

test('vector/scalar products retain scalar typing without coercion or promotion', () => {
  const ir = lower('function(a,b){return[a[0]*b,a[1]*b]}', ['vec2', 'f64']);
  assert.deepEqual(ir.params.map(p => p.type), ['vec2', 'f64']);
  assert.equal(ir.result.type, 'vec2');
  assert.deepEqual(ir.operations.filter(o => o.op === 'binary').map(o => o.right), ['arg1', 'arg1']);
  assert.throws(() => lower('function(a,b){return b[0]}', ['vec2', 'f64']));
});
