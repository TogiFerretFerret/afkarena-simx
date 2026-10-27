import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceDependencies, closeSourceSelection } from '../native-source-closure.mjs';

test('closure excludes local names, property keys, strings and comments', () => {
  const globals = new Map(['local','helper','named','key','stringOnly','commentOnly'].map(x => [x, []]));
  const source = 'function named(local){var key=2;/* commentOnly */return {key:local,text:"stringOnly",other:helper()};}';
  assert.deepEqual([...sourceDependencies(source, globals)], ['helper']);
});
test('closure retains static ed paths and excludes a shadowed ed parameter', () => {
  assert.deepEqual([...sourceDependencies('function(){return ed.Foo["bar"]()+ed.Baz;}',new Map())].sort(), ['ed.Baz','ed.Foo','ed.Foo.bar']);
  assert.deepEqual([...sourceDependencies('function(ed){return ed.Foo;}',new Map())], []);
});
test('closure follows free globals and audited startup statements transitively', () => {
  const records={definitions:new Map([['ed.Main',[{source:'function(){return helper()+ed.Child.run();}'}]],['ed.Child',[{source:'({})'}]],['ed.Child.run',[{source:'function(){return leaf;}'}]]]),globals:new Map([['helper',[{source:'function(){return ed.Last;}'}]],['leaf',[{source:'2'}]]]),initializers:[{source:'ed.ready=boot;'}],postInitializers:[],functionDeclarations:[]};
  records.globals.set('boot',[{source:'function(){return 1;}'}]);
  assert.deepEqual([...closeSourceSelection(records,['ed.Main'])].sort(), ['boot','ed','ed.Child','ed.Child.run','ed.Last','ed.Main','ed.ready','helper','leaf']);
});
