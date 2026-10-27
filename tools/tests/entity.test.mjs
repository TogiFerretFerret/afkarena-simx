import test from 'node:test';
import assert from 'node:assert/strict';
import { bits } from '../rng-trace.mjs';
import { loadEntitySource, createEntityOracle, compareEntityTrace } from '../check-entity.mjs';

const { source } = await loadEntitySource();
const make = (position, velocity, direction, dt, vectors) => ({ position, velocity,
  direction: bits(direction), dt: bits(dt), vectors: vectors.map(v => v.map(bits)) });

test('aliased position and velocity observe earlier writes and use updated x for direction', () => {
  const oracle = createEntityOracle(source);
  const trace = oracle(make(0, 0, 1, -2, [[1, 3], [7, 9]]));
  assert.deepEqual(trace.events.map(e => e.kind), ['enter', 'position_x_write', 'position_y_write', 'direction_write', 'return']);
  assert.equal(trace.events[1].vectors[0][0], bits(-1));
  assert.equal(trace.events[1].vectors[0][1], bits(3));
  assert.equal(trace.events[2].vectors[0][1], bits(-3));
  assert.equal(trace.events[3].direction, bits(-1));
  assert.deepEqual(trace.events.at(-1).vectors[1], [bits(7), bits(9)]);
});

test('separate position and velocity retain identities and skip untaken direction branch', () => {
  const trace = createEntityOracle(source)(make(1, 0, 1, .5, [[2, -4], [10, 20], [7, 9]]));
  assert.deepEqual(trace.events.map(e => e.kind), ['enter', 'position_x_write', 'position_y_write', 'return']);
  assert.equal(trace.events.at(-1).position, 1);
  assert.equal(trace.events.at(-1).velocity, 0);
  assert.deepEqual(trace.events.at(-1).vectors, [[bits(2), bits(-4)], [bits(11), bits(18)], [bits(7), bits(9)]]);
});

test('instrumentation preserves original final bits for normal and pathological inputs', () => {
  const plain = createEntityOracle(source, { instrumented: false });
  const traced = createEntityOracle(source);
  for (const x of [0, -0, 1, -1, Number.MIN_VALUE, Number.MAX_VALUE, Infinity, -Infinity, NaN]) {
    for (const alias of [false, true]) {
      const input = make(0, alias ? 0 : 1, x, .125, [[x, -1], [-x, 1], [7, 9]]);
      assert.deepEqual(traced(input).events.at(-1), plain(input).events.at(-1));
    }
  }
});

test('trace comparison detects missed writes, aliases, arena mutations and signed zero', () => {
  const expected = createEntityOracle(source)(make(0, 0, 1, .125, [[0, -0], [7, 9]]));
  assert.equal(compareEntityTrace(expected, expected).match, true);
  const copy = () => structuredClone(expected);
  let actual = copy(); actual.events.splice(1, 1);
  assert.equal(compareEntityTrace(expected, actual).reason, 'event_count');
  actual = copy(); actual.events[0].velocity = 1;
  assert.equal(compareEntityTrace(expected, actual).field, 'velocity');
  actual = copy(); actual.events[1].vectors[1][0] = bits(8);
  assert.equal(compareEntityTrace(expected, actual).reason, 'vector_bits');
  actual = copy(); actual.events[0].vectors[0][1] = bits(0);
  assert.equal(compareEntityTrace(expected, actual).match, false);
});
