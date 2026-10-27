import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {installBootstrapFunctionDeclarations} from '../bootstrap-declarations.mjs';
const record=source=>({source,file:'fixture.js',start:0});

test('original declaration self-reference follows global reassignment',()=>{
 const context=createContext({});
 installBootstrapFunctionDeclarations(context,[record('function original(){return original;}')]);
 const before=context.original;
 context.original=runInContext('(function replacement(){return 42;})',context);
 assert.equal(before(),context.original,'named expression wrapping would incorrectly return before');
});

test('declarations hoist in source order without invoking bodies',()=>{
 const context=createContext({calls:0});
 installBootstrapFunctionDeclarations(context,[record('function same(){calls++;return 1;}'),record('function same(){calls++;return 2;}')]);
 assert.equal(context.calls,0);assert.equal(context.same(),2);assert.equal(context.calls,1);
});
