import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDescendants} from '../native-process-discovery.mjs';

test('finds native children through helper descendants without task/children',()=>{
 const table='1 0 init\n10 1 MainThread\n11 10 MainThread\n12 11 helper\n13 12 rust-battle-pro\n14 1 rust-battle-pro\n15 11 node\n16 15 rust-battle-pro\n17 10 ps\n';
 assert.deepEqual(nativeDescendants(table,10),[13,16]);
 assert.deepEqual(nativeDescendants(table,11),[13,16]);
 assert.deepEqual(nativeDescendants(table,14),[]);
 assert.deepEqual(nativeDescendants('bad row\n1 1 rust-battle-pro\n',1),[]);
});
